import { expect, test, vi } from "vite-plus/test";
import { DEFAULT_INSTANCE, type Instances } from "./instances";
import { FREECORPS_BRIGADE, FREECORPS_RELAY } from "./relay";
import {
  instanceBoard,
  onCallNow,
  otherTrouble,
  relayView,
  removal,
  switcherGroups,
  type InstanceState,
  type RelayView,
} from "./switcher";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const HOUR = 3_600_000;
const INSTANCE_ID = "ins_aaaaaaaaaaaaaaaaaaaaaa";

const list: Instances = {
  instances: [
    { id: DEFAULT_INSTANCE, origin: FREECORPS_BRIGADE },
    { id: "acme1", origin: "https://brigade.acme.example" },
    { id: "own1", origin: "https://incidents.own.example" },
  ],
  active: DEFAULT_INSTANCE,
};

const freecorps: RelayView = { kind: "freecorps", foreign: false };
const signedIn = (over: Partial<Extract<InstanceState, { kind: "signed-in" }>>): InstanceState => ({
  kind: "signed-in",
  userId: "u",
  name: "Ana",
  email: "ana@example.com",
  workspaces: [],
  registrations: {},
  ...over,
});

test("one list grouped by instance, labelled 'Instance · Workspace', the open one first", () => {
  const groups = switcherGroups({
    list,
    states: {
      [DEFAULT_INSTANCE]: signedIn({
        workspaceId: "w2",
        workspaces: [
          { id: "w1", name: "Staging" },
          { id: "w2", name: "Production" },
        ],
        registrations: { w1: "on", w2: "pending" },
      }),
      acme1: signedIn({
        workspaceId: "a1",
        workspaces: [{ id: "a1", name: "Ops" }, { id: "a2" }],
        registrations: { a1: "failed", a2: "on" },
      }),
      own1: { kind: "signed-out" },
    },
    relays: { [DEFAULT_INSTANCE]: freecorps, acme1: freecorps, own1: freecorps },
    unnamed: "Workspace",
  });
  expect(groups.map((group) => [group.label, group.active, group.state])).toEqual([
    ["Freecorps", true, "signed-in"],
    ["brigade.acme.example", false, "signed-in"],
    ["incidents.own.example", false, "signed-out"],
  ]);
  expect(groups[0]!.rows.map((row) => [row.label, row.current, row.paging])).toEqual([
    ["Freecorps · Production", true, "pending"],
    ["Freecorps · Staging", false, "on"],
  ]);
  expect(groups[1]!.rows.map((row) => [row.label, row.current, row.paging, row.detail])).toEqual([
    ["brigade.acme.example · Ops", false, "not-paged", "failed"],
    ["brigade.acme.example · Workspace", false, "on", undefined],
  ]);
  expect(groups[2]!.rows).toEqual([]);
  expect(groups[0]!.account).toEqual({ name: "Ana", email: "ana@example.com" });
});

test("with one instance, rows are the workspace's name alone", () => {
  const groups = switcherGroups({
    list: { instances: [list.instances[0]!], active: DEFAULT_INSTANCE },
    states: { [DEFAULT_INSTANCE]: signedIn({ workspaceId: "w1", workspaces: [] }) },
    relays: {},
    unnamed: "Workspace",
  });
  // The open workspace is listed even before the phone kept it.
  expect(groups[0]!.rows.map((row) => row.label)).toEqual(["Workspace"]);
});

test("foreign and no relay say so on every row of the instance", () => {
  const groups = switcherGroups({
    list,
    states: {
      acme1: signedIn({
        workspaces: [{ id: "a1", name: "Ops" }],
        registrations: { a1: "foreign" },
      }),
      own1: signedIn({ workspaces: [{ id: "o1", name: "Ops" }], registrations: { o1: "on" } }),
      [DEFAULT_INSTANCE]: signedIn({ workspaces: [{ id: "w1", name: "P" }] }),
    },
    relays: {
      acme1: { kind: "own", host: "relay.acme.example", foreign: true },
      own1: { kind: "none" },
      // The build's default instance without a relay pages with the raw tokens.
      [DEFAULT_INSTANCE]: { kind: "none" },
    },
    unnamed: "Workspace",
  });
  expect(groups[1]!.paging).toBe("foreign");
  expect(groups[1]!.rows[0]!.paging).toBe("foreign");
  expect(groups[2]!.paging).toBe("no-relay");
  expect(groups[2]!.rows[0]!.paging).toBe("no-relay");
  expect(groups[0]!.paging).toBeUndefined();
});

test("which relay: Freecorps', its own with the host, none, foreign", () => {
  const brigade = (relay?: object) => ({
    kind: "brigade" as const,
    versioned: true,
    ...(relay ? { relay: relay as { origin: string; instance: string } } : {}),
  });
  expect(
    relayView(brigade({ origin: FREECORPS_RELAY, instance: INSTANCE_ID }), FREECORPS_RELAY, false),
  ).toEqual({
    kind: "freecorps",
    foreign: false,
  });
  expect(
    relayView(
      brigade({
        origin: "https://relay.acme.example",
        instance: INSTANCE_ID,
        app: "https://apps.acme.example",
      }),
      FREECORPS_RELAY,
      false,
    ),
  ).toEqual({
    kind: "own",
    host: "relay.acme.example",
    foreign: true,
    app: "https://apps.acme.example",
  });
  // A company's own build, paged by its own relay: its own, not foreign.
  expect(
    relayView(
      brigade({ origin: "https://relay.acme.example", instance: INSTANCE_ID }),
      "https://relay.acme.example",
      false,
    ),
  ).toEqual({ kind: "own", host: "relay.acme.example", foreign: false });
  expect(relayView(brigade(), FREECORPS_RELAY, false)).toEqual({ kind: "none" });
  expect(relayView({ kind: "unreachable" }, FREECORPS_RELAY, false)).toEqual({ kind: "unknown" });
});

test("the notice names another instance's workspace where this phone is not paged", () => {
  const groups = switcherGroups({
    list,
    states: {
      [DEFAULT_INSTANCE]: signedIn({
        workspaces: [{ id: "w1", name: "P" }],
        registrations: { w1: "failed" },
      }),
      acme1: signedIn({
        workspaces: [
          { id: "a1", name: "Ops" },
          { id: "a2", name: "Infra" },
        ],
        registrations: { a1: "unsupported", a2: "off" },
      }),
    },
    relays: {},
    unnamed: "Workspace",
  });
  // The active instance's own trouble is the account section's; `unsupported` is not the member's to fix.
  expect(otherTrouble(groups)?.label).toBe("brigade.acme.example · Infra");
  const fine = switcherGroups({
    list,
    states: { acme1: signedIn({ workspaces: [{ id: "a1" }], registrations: { a1: "on" } }) },
    relays: {},
    unnamed: "Workspace",
  });
  expect(otherTrouble(fine)).toBeUndefined();
});

test("on call now, from the shifts last seen on the phone", () => {
  const workspaces = [
    {
      id: "a",
      name: "Ops",
      oncall: {
        shifts: [[NOW - HOUR, NOW + HOUR]] as [number, number | null][],
        staleAt: NOW + HOUR,
      },
    },
    {
      id: "b",
      name: "Open",
      oncall: { shifts: [[NOW - HOUR, null]] as [number, number | null][], staleAt: NOW + HOUR },
    },
    {
      id: "c",
      name: "Later",
      oncall: {
        shifts: [[NOW + HOUR, null]] as [number, number | null][],
        staleAt: NOW + 2 * HOUR,
      },
    },
    {
      id: "d",
      name: "Stale",
      oncall: { shifts: [[NOW - HOUR, null]] as [number, number | null][], staleAt: NOW - 1 },
    },
    { id: "e", name: "Never seen" },
  ];
  expect(onCallNow(workspaces, NOW).map((one) => one.name)).toEqual(["Ops", "Open"]);
});

test("removal: never the last instance; others after an on-call warning", () => {
  const one: Instances = { instances: [list.instances[0]!], active: DEFAULT_INSTANCE };
  expect(removal(one, DEFAULT_INSTANCE, { kind: "signed-out" }, NOW, "W")).toEqual({
    kind: "last",
  });
  // A non-default instance left alone is the last too.
  const alone: Instances = { instances: [list.instances[1]!], active: "acme1" };
  expect(removal(alone, "acme1", { kind: "signed-out" }, NOW, "W")).toEqual({ kind: "last" });
  expect(removal(list, "nope", { kind: "signed-out" }, NOW, "W")).toEqual({ kind: "last" });
  // The build's default instance can go while another remains.
  expect(removal(list, DEFAULT_INSTANCE, { kind: "signed-out" }, NOW, "W")).toEqual({
    kind: "remove",
    signedIn: false,
    onCall: [],
    unknown: false,
  });
  const onCall = signedIn({
    workspaces: [
      { id: "a", name: "Ops", oncall: { shifts: [[NOW - HOUR, null]], staleAt: NOW + HOUR } },
      { id: "b", oncall: { shifts: [[NOW - HOUR, null]], staleAt: NOW + HOUR } },
    ],
  });
  expect(removal(list, "acme1", onCall, NOW, "W")).toEqual({
    kind: "remove",
    signedIn: true,
    onCall: ["Ops", "W"],
    unknown: false,
  });
  // Shifts never seen on the phone: the general warning.
  expect(removal(list, "acme1", signedIn({ workspaces: [{ id: "a" }] }), NOW, "W")).toEqual({
    kind: "remove",
    signedIn: true,
    onCall: [],
    unknown: true,
  });
});

test("the board tells its readers only of changes", () => {
  const board = instanceBoard();
  const heard = vi.fn();
  const leave = board.subscribe(heard);
  board.publish("acme1", { kind: "signed-out" });
  board.publish("acme1", { kind: "signed-out" });
  expect(heard).toHaveBeenCalledTimes(1);
  expect(board.current()).toEqual({ acme1: { kind: "signed-out" } });
  board.forget("acme1");
  board.forget("acme1");
  expect(heard).toHaveBeenCalledTimes(2);
  leave();
  board.publish("own1", { kind: "unknown" });
  expect(heard).toHaveBeenCalledTimes(2);
});
