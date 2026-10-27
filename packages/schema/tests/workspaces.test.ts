import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  DEFAULT_EMAIL_SETTINGS,
  emailSettings,
  mutations,
  serverMutations,
  newId,
  ROLES,
  runMutation,
  WORKSPACE_NAME_MAX,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));

const ctx = (role: Role = "owner"): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now: T,
  server: true,
});

describe("workspace.create", () => {
  test("is server only: not among the mutations a socket may send", () => {
    expect(Object.keys(mutations)).not.toContain("workspace.create");
    expect(Object.keys(serverMutations)).toEqual([
      ...Object.keys(mutations),
      "statusPage.configure",
      "workspace.create",
      "member.sync",
      "member.changeRole",
      "member.remove",
      "member.reconcile",
      "invitation.create",
      "invitation.revoke",
      "invitation.decline",
      "member.add",
      "monitor.report",
      "monitor.evaluate",
      "device.expire",
      "device.signOut",
      "monitor.takeOver",
      "notification.fail",
      "notification.failEmail",
      "delivery.plan",
      "delivery.report",
      "delivery.confirm",
      "escalation.start",
      "escalation.advance",
      "escalation.fallback",
      "escalation.repage",
      "escalation.unreached",
      "slack.connect",
      "notification.failSlack",
      "webhook.create",
      "webhook.rotateSecret",
      "webhook.record",
      "webhook.redeliver",
      "postmortem.requestDraft",
      "postmortem.writeDraft",
      "postmortem.failDraft",
      "export.record",
      "export.reserve",
      "alert.ingest",
      "alert.reroute",
      "alertSource.takeOver",
    ]);
    const result = runMutation(
      mutations,
      "workspace.create" as never,
      { id: WS, name: "Acme" },
      createMemoryStore<BrigadeTables>(),
      ctx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
  });

  test("writes the workspace row and emits workspace.created", () => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: " Acme " },
      store,
      ctx(),
    );
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "workspace.created",
          subject: WS,
          data: { id: WS, name: "Acme", createdBy: "usr_ana" },
        },
      ],
    });
    expect(store.scan("workspace")).toEqual([
      { id: WS, name: "Acme", createdAt: T, createdBy: "usr_ana" },
    ]);
  });

  test("runs once per shard", () => {
    const store = createMemoryStore<BrigadeTables>();
    runMutation(serverMutations, "workspace.create", { id: WS, name: "Acme" }, store, ctx());
    const again = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: "Other" },
      store,
      ctx(),
    );
    expect(again).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.scan("workspace")).toHaveLength(1);
  });

  test.each(ROLES.filter((role) => role !== "owner"))("%s cannot create it", (role) => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: "Acme" },
      store,
      ctx(role),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(store.scan("workspace")).toEqual([]);
  });

  test.each([
    ["an empty name", { id: WS, name: "  " }],
    ["a name that is too long", { id: WS, name: "x".repeat(WORKSPACE_NAME_MAX + 1) }],
    [
      "an id that is not a workspace id",
      { id: newId("inc", T, () => new Uint8Array(10)), name: "Acme" },
    ],
  ])("refuses %s", (_name, args) => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(serverMutations, "workspace.create", args, store, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });
});

describe("workspace.setEmail", () => {
  const provisioned = () => {
    const store = createMemoryStore<BrigadeTables>();
    runMutation(serverMutations, "workspace.create", { id: WS, name: "Acme" }, store, ctx());
    return store;
  };

  test("both emails are on until an owner or admin turns them off; responders and viewers may not", () => {
    const store = provisioned();
    expect(emailSettings(store.get("workspace", WS))).toEqual(DEFAULT_EMAIL_SETTINGS);
    expect(DEFAULT_EMAIL_SETTINGS).toEqual({ unpaged: true, nobodyPaged: true });
    for (const role of ["responder", "viewer"] as const) {
      const refused = runMutation(
        mutations,
        "workspace.setEmail",
        { unpaged: false, nobodyPaged: true },
        store,
        ctx(role),
      );
      expect(refused, role).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    const result = runMutation(
      mutations,
      "workspace.setEmail",
      { unpaged: false, nobodyPaged: true },
      store,
      ctx("admin"),
    );
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "workspace.email_changed",
          subject: WS,
          data: { unpaged: false, nobodyPaged: true },
        },
      ],
    });
    expect(emailSettings(store.get("workspace", WS))).toEqual({
      unpaged: false,
      nobodyPaged: true,
    });
    // The same again changes nothing.
    expect(
      runMutation(
        mutations,
        "workspace.setEmail",
        { unpaged: false, nobodyPaged: true },
        store,
        ctx(),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    // Both are required.
    expect(
      runMutation(mutations, "workspace.setEmail", { unpaged: true }, store, ctx()),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });
});
