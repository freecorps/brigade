// The instance and workspace switcher (RFC 0015 section 5 "The switcher", section 8 "Which relay"): every instance
// this phone signs in to with the workspaces it pages the member for there, as one list grouped by instance
// ("Freecorps · Production", "Acme · Ops"), each with whether this phone is paged; which relay each instance pages
// through; and what removing one does. Pure, so it is tested in Node; src/components/instances.tsx draws it from the
// session (the active instance) and the board the background instances publish to (`instanceBoard`).
import type { Paging, Registrations } from "@/lib/device";
import { instanceLabel, hostOf } from "@/lib/instance-address";
import { DEFAULT_INSTANCE, type Instance, type Instances } from "@/lib/instances";
import type { PhoneWorkspace } from "@/lib/phone-workspaces";
import { FREECORPS_RELAY, relayPlan, type InstanceConfig } from "@/lib/relay";

/** What the app knows of the member at an instance. */
export type InstanceState =
  /** Not read yet (the session is loading). */
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      userId: string;
      name: string;
      email: string;
      /** The workspace open there. */
      workspaceId?: string;
      /** The workspaces this phone pages them for there (src/lib/phone-workspaces.ts), with names as last seen. */
      workspaces: PhoneWorkspace[];
      registrations: Registrations;
    };

/**
 * Which relay an instance pages phones through, as its `/config` says: Freecorps', its own (with the host), none
 * (it cannot page phones through a relay with handles), or not known yet. `foreign`: its relay is not this build's,
 * so only its own app build is paged by it (src/lib/relay.ts `relayPlan`).
 */
export type RelayView =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "freecorps"; foreign: boolean }
  | { kind: "own"; host: string; foreign: boolean; app?: string };

export function relayView(
  config: InstanceConfig,
  thisBuild: string | undefined,
  isDefault: boolean,
): RelayView {
  if (config.kind !== "brigade") return { kind: "unknown" };
  if (!config.relay) return { kind: "none" };
  const foreign = relayPlan(config, thisBuild, isDefault).kind === "foreign";
  if (config.relay.origin === FREECORPS_RELAY) return { kind: "freecorps", foreign };
  return {
    kind: "own",
    host: hostOf(config.relay.origin),
    foreign,
    ...(config.relay.app ? { app: config.relay.app } : {}),
  };
}

/**
 * A row's paging state: `on`; `pending` (setting up); `not-paged` (`detail` says why); `foreign` (only the instance's
 * own app is paged); `no-relay` (it cannot page this phone).
 */
export type RowPaging = "on" | "pending" | "not-paged" | "foreign" | "no-relay";

export type SwitcherRow = {
  instanceId: string;
  workspaceId: string;
  /** "Acme · Ops" with several instances; the workspace's name alone with one. */
  label: string;
  workspaceName: string;
  /** The instance and workspace the app shows. */
  current: boolean;
  paging: RowPaging;
  /** Why it is not paged, as the registration said (`not-paged` only). */
  detail?: Paging;
};

export type SwitcherGroup = {
  instance: Instance;
  label: string;
  /** In full, as the details sheet and the sign-in screen name it. */
  host: string;
  active: boolean;
  state: InstanceState["kind"];
  /** Who is signed in there. */
  account?: { name: string; email: string };
  /** The instance-wide reason none of its workspaces is paged, when there is one. */
  paging?: "foreign" | "no-relay";
  rows: SwitcherRow[];
};

export type SwitcherInput = {
  list: Instances;
  /** Each instance's state, by id; the active one's from its session. */
  states: Record<string, InstanceState>;
  relays: Record<string, RelayView>;
  /** Named when a workspace's name was never seen on the phone. */
  unnamed: string;
};

/** Why a phone is not paged that the member can act on (src/components/account.tsx `pagingProblem`). */
const PROBLEMS: ReadonlySet<Paging> = new Set(["off", "taken", "limit", "failed"]);

/** Whether an instance cannot page this phone at all, and why. */
export function instancePaging(
  relay: RelayView,
  isDefault: boolean,
): "foreign" | "no-relay" | undefined {
  if ((relay.kind === "freecorps" || relay.kind === "own") && relay.foreign) return "foreign";
  // The build's default instance pages with the raw tokens without a relay, as before relay handles.
  if (relay.kind === "none" && !isDefault) return "no-relay";
  return undefined;
}

/** One group per instance, in the list's order; the open workspace first in the active one. */
export function switcherGroups(input: SwitcherInput): SwitcherGroup[] {
  const several = input.list.instances.length > 1;
  return input.list.instances.map((instance) => {
    const state = input.states[instance.id] ?? { kind: "unknown" };
    const relay = input.relays[instance.id] ?? { kind: "unknown" };
    const active = instance.id === input.list.active;
    const label = instanceLabel(instance.origin);
    const blocked = instancePaging(relay, instance.id === DEFAULT_INSTANCE);
    const rows: SwitcherRow[] = [];
    if (state.kind === "signed-in") {
      const ordered = [
        ...state.workspaces.filter((one) => one.id === state.workspaceId),
        ...state.workspaces.filter((one) => one.id !== state.workspaceId),
      ];
      // The open one, even before the phone kept it.
      if (state.workspaceId && !ordered.some((one) => one.id === state.workspaceId)) {
        ordered.unshift({ id: state.workspaceId });
      }
      for (const workspace of ordered) {
        const name = workspace.name?.trim() ? workspace.name : input.unnamed;
        const registered = state.registrations[workspace.id];
        const paging: RowPaging =
          blocked ??
          (registered === "on"
            ? "on"
            : registered === undefined || registered === "pending"
              ? "pending"
              : "not-paged");
        rows.push({
          instanceId: instance.id,
          workspaceId: workspace.id,
          label: several ? `${label} · ${name}` : name,
          workspaceName: name,
          current: active && workspace.id === state.workspaceId,
          paging,
          ...(paging === "not-paged" && registered ? { detail: registered } : {}),
        });
      }
    }
    return {
      instance,
      label,
      host: hostOf(instance.origin),
      active,
      state: state.kind,
      ...(state.kind === "signed-in" ? { account: { name: state.name, email: state.email } } : {}),
      ...(blocked ? { paging: blocked } : {}),
      rows,
    };
  });
}

/**
 * The first workspace of another instance where this phone should page the member and does not, for the incident
 * list's notice ("This phone isn't paging you in Acme · Ops"). The open instance's own are the account section's
 * (`pagingTrouble`); an instance that pages through its own app is said on its row, not as trouble.
 */
export function otherTrouble(groups: SwitcherGroup[]): SwitcherRow | undefined {
  for (const group of groups) {
    if (group.active) continue;
    const row = group.rows.find(
      (one) => one.paging === "not-paged" && one.detail !== undefined && PROBLEMS.has(one.detail),
    );
    if (row) return row;
  }
  return undefined;
}

/** The workspaces where the member's shifts, as last seen on the phone, have them on call at `now`. */
export function onCallNow(workspaces: PhoneWorkspace[], now: number): PhoneWorkspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.oncall !== undefined &&
      workspace.oncall.staleAt > now &&
      workspace.oncall.shifts.some(([start, end]) => start <= now && (end === null || end > now)),
  );
}

/**
 * What removing an instance does: `last` when it is the only one (signing out is what is left; removing would leave
 * the app with no instance to sign in to, the build's default included); otherwise it signs out of it, after a
 * warning naming the workspaces where the member is on call there now (`onCall`, as last seen on the phone; an
 * instance whose shifts the phone never saw gets the general warning, `unknown`). An instance whose session was not
 * read yet counts as signed in: the warnings err towards saying too much.
 */
export type Removal =
  | { kind: "last" }
  | { kind: "remove"; signedIn: boolean; onCall: string[]; unknown: boolean };

export function removal(
  list: Instances,
  id: string,
  state: InstanceState,
  now: number,
  unnamed: string,
): Removal {
  if (!list.instances.some((one) => one.id === id) || list.instances.length <= 1) {
    return { kind: "last" };
  }
  if (state.kind === "signed-out") {
    return { kind: "remove", signedIn: false, onCall: [], unknown: false };
  }
  // Not read yet (loading, offline): maybe signed in, and maybe on call there. Warned as if so.
  if (state.kind === "unknown")
    return { kind: "remove", signedIn: true, onCall: [], unknown: true };
  const onCall = onCallNow(state.workspaces, now).map((one) => one.name?.trim() || unnamed);
  return {
    kind: "remove",
    signedIn: true,
    onCall,
    unknown: onCall.length === 0 && !state.workspaces.some((one) => one.oncall !== undefined),
  };
}

/**
 * What the board holds for every instance but the active one, published by each background instance
 * (src/components/session.tsx `BackgroundInstance`), so the switcher shows their paging without a socket of its own.
 */
export function instanceBoard() {
  let states: Record<string, InstanceState> = {};
  const listeners = new Set<() => void>();
  return {
    current: () => states,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (id: string, state: InstanceState) => {
      if (JSON.stringify(states[id]) === JSON.stringify(state)) return;
      states = { ...states, [id]: state };
      for (const listener of listeners) listener();
    },
    forget: (id: string) => {
      if (!(id in states)) return;
      const { [id]: _, ...rest } = states;
      states = rest;
      for (const listener of listeners) listener();
    },
  };
}

export type InstanceBoard = ReturnType<typeof instanceBoard>;
