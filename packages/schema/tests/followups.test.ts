// Follow-ups, postmortems and exports (RFC 0013): who may change them, the caps, the timeline entries and events,
// the postmortem's conflict check and AI draft states, and what an export file holds.
import { describe, expect, test } from "vite-plus/test";
import {
  AI_ACTOR,
  AI_DRAFT_STALE_MS,
  AI_DRAFTS_PER_DAY,
  buildExport,
  exportChunks,
  EXPORTS_PER_HOUR,
  EXPORT_WINDOW_MS,
  createMemoryStore,
  EMPTY_SECTIONS,
  EXPORT_TTL_MS,
  isDueDate,
  isOverdue,
  MAX_FOLLOW_UPS_PER_INCIDENT,
  MAX_OPEN_FOLLOW_UPS,
  MAX_LISTED_EXPORTS,
  MEMBERS_ACTOR,
  mutations,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  type BrigadeTables,
  type MutationContext,
  type MutationStore,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);
const INC = "inc_01JB0000000000000000000001";
const INC2 = "inc_01JB0000000000000000000002";
const FUP = "fup_01JB0000000000000000000001";
const FUP2 = "fup_01JB0000000000000000000002";
const DRF = "drf_01JB0000000000000000000001";
const DRF2 = "drf_01JB0000000000000000000002";
const EXP = "exp_01JB0000000000000000000001";

const ctx = (id: string, role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id, role },
  now,
  server: true,
});
const owner = ctx("usr_ana", "owner");
const responder = ctx("usr_caio", "responder");
const viewer = ctx("usr_duda", "viewer");
const ai = (now = T): MutationContext => ({ actor: AI_ACTOR, now, server: true });

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  store.insert("workspace", { id: "ws_x", name: "Acme", createdAt: 0, createdBy: "usr_ana" });
  run(store, "incident.declare", { id: INC, title: "Checkout down", severity: "sev1" });
  return store;
}

const run = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(mutations, name, args, store, context);
const server = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(serverMutations, name, args, store, context);

const followUp = (patch: Record<string, unknown> = {}) => ({
  id: FUP,
  incidentId: INC,
  title: "Add a retry budget to the gateway client",
  ownerId: "usr_caio",
  dueDate: "2026-11-02",
  link: "https://issues.example.com/PAY-12",
  ...patch,
});

const timelineKinds = (store: MutationStore) =>
  store
    .scan("timeline")
    .filter((entry) => entry.kind === "follow_up" || entry.kind === "postmortem")
    .map((entry) =>
      entry.kind === "follow_up" || entry.kind === "postmortem" ? entry.change : null,
    );

describe("follow-ups", () => {
  test("responders add, edit, complete, reopen and remove them, each on the timeline", () => {
    const store = shard();
    expect(run(store, "followUp.create", followUp(), responder)).toMatchObject({
      ok: true,
      events: [{ type: "follow_up.created", data: { status: "open", ownerId: "usr_caio" } }],
    });
    expect(
      run(store, "followUp.update", { ...followUp({ dueDate: null }), incidentId: undefined }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    const { incidentId: _incident, ...edit } = followUp({ dueDate: null, link: null });
    expect(run(store, "followUp.update", edit, responder)).toMatchObject({
      ok: true,
      events: [{ type: "follow_up.updated", data: { reason: "edited", dueDate: null } }],
    });
    expect(run(store, "followUp.update", edit, responder)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, "followUp.setStatus", { id: FUP, status: "done" }, responder)).toMatchObject({
      ok: true,
      events: [{ type: "follow_up.completed" }],
    });
    expect(store.get("follow_ups", FUP)).toMatchObject({ doneAt: T, doneBy: "usr_caio" });
    run(store, "followUp.setStatus", { id: FUP, status: "open" }, responder);
    expect(store.get("follow_ups", FUP)).toMatchObject({ status: "open", doneAt: null });
    expect(run(store, "followUp.delete", { id: FUP }, responder)).toMatchObject({
      ok: true,
      events: [{ type: "follow_up.deleted" }],
    });
    expect(timelineKinds(store)).toEqual(["added", "edited", "done", "reopened", "removed"]);
  });

  test("viewers cannot change them, and cannot own them", () => {
    const store = shard();
    expect(run(store, "followUp.create", followUp(), viewer)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(run(store, "followUp.create", followUp({ ownerId: "usr_duda" }))).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "ownerId" }] },
    });
    expect(run(store, "followUp.create", followUp({ ownerId: "usr_nobody" }))).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });

  test("checks the due date and the link", () => {
    const store = shard();
    for (const dueDate of ["2026-02-30", "2026-13-01", "26-11-02", "1999-12-31"]) {
      expect(run(store, "followUp.create", followUp({ dueDate }))).toMatchObject({
        ok: false,
        error: { code: "invalid_args" },
      });
    }
    expect(isDueDate("2028-02-29")).toBe(true);
    expect(run(store, "followUp.create", followUp({ link: "javascript:alert(1)" }))).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(run(store, "followUp.create", followUp({ incidentId: INC2 }))).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test(`at most ${MAX_FOLLOW_UPS_PER_INCIDENT} per incident`, () => {
    const store = shard();
    for (let index = 0; index < MAX_FOLLOW_UPS_PER_INCIDENT; index++) {
      const id = `fup_01JB${String(index).padStart(22, "0")}`;
      expect(run(store, "followUp.create", followUp({ id }))).toMatchObject({ ok: true });
    }
    expect(
      run(store, "followUp.create", followUp({ id: FUP2.replace("01JB", "01JC") })),
    ).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test(`at most ${MAX_OPEN_FOLLOW_UPS} open per workspace, on create and on reopen`, () => {
    const store = shard();
    const perIncident = MAX_FOLLOW_UPS_PER_INCIDENT;
    const incidents = Array.from(
      { length: MAX_OPEN_FOLLOW_UPS / perIncident + 1 },
      (_, index) => `inc_01JG${String(index).padStart(22, "0")}`,
    );
    for (const id of incidents) run(store, "incident.declare", { id, title: "Load test" });
    const fup = (index: number) => `fup_01JG${String(index).padStart(22, "0")}`;
    for (let index = 0; index < MAX_OPEN_FOLLOW_UPS; index++) {
      const incidentId = incidents[Math.floor(index / perIncident)]!;
      expect(run(store, "followUp.create", followUp({ id: fup(index), incidentId }))).toMatchObject(
        { ok: true },
      );
    }
    const last = incidents.at(-1)!;
    const extra = followUp({ id: fup(MAX_OPEN_FOLLOW_UPS), incidentId: last });
    expect(run(store, "followUp.create", extra)).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
    // Done ones leave room; reopening one counts again.
    run(store, "followUp.setStatus", { id: fup(0), status: "done" });
    expect(run(store, "followUp.create", extra)).toMatchObject({ ok: true });
    expect(run(store, "followUp.setStatus", { id: fup(0), status: "open" })).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
    expect(store.get("follow_ups", fup(0))!.status).toBe("done");
  });

  test("an owner who leaves is taken off open follow-ups, not done ones", () => {
    const store = shard();
    run(store, "followUp.create", followUp());
    run(store, "followUp.create", followUp({ id: FUP2 }));
    run(store, "followUp.setStatus", { id: FUP2, status: "done" });
    const result = server(
      store,
      "member.changeRole",
      { id: "usr_caio", from: "responder", to: "viewer" },
      { ...owner, actor: MEMBERS_ACTOR },
    );
    expect(result.ok && result.events.map((event) => event.type)).toContain("follow_up.updated");
    expect(store.get("follow_ups", FUP)!.ownerId).toBeNull();
    expect(store.get("follow_ups", FUP2)!.ownerId).toBe("usr_caio");
  });

  test("the open view lists every incident's open ones, soonest due first", () => {
    const store = shard();
    run(store, "incident.declare", { id: INC2, title: "Search slow" });
    run(store, "followUp.create", followUp({ dueDate: null }));
    run(store, "followUp.create", followUp({ id: FUP2, incidentId: INC2, dueDate: "2026-10-01" }));
    const open = runQuery(queries, "followUps.open", {}, store, "viewer");
    expect(open.ok && open.rows.map((row) => (row as { id: string }).id)).toEqual([FUP2, FUP]);
    const one = runQuery(queries, "incident.followUps", { id: INC2 }, store, "viewer");
    expect(one.ok && one.rows).toHaveLength(1);
  });

  test("overdue: open and due before the reader's today", () => {
    expect(isOverdue({ status: "open", dueDate: "2026-10-25" }, "2026-10-26")).toBe(true);
    expect(isOverdue({ status: "open", dueDate: "2026-10-26" }, "2026-10-26")).toBe(false);
    expect(isOverdue({ status: "done", dueDate: "2026-10-01" }, "2026-10-26")).toBe(false);
    expect(isOverdue({ status: "open", dueDate: null }, "2026-10-26")).toBe(false);
  });
});

const sections = (patch: Partial<typeof EMPTY_SECTIONS> = {}) => ({
  ...EMPTY_SECTIONS,
  summary: "Checkout failed for 20 minutes.",
  ...patch,
});

describe("postmortems", () => {
  test("saves over the revision it opened, and refuses a stale one", () => {
    const store = shard();
    expect(
      run(
        store,
        "postmortem.save",
        { id: INC, sections: sections(), baseRevision: 0, baseUpdatedAt: 0 },
        responder,
      ),
    ).toMatchObject({ ok: true, events: [{ type: "postmortem.saved", data: { revision: 1 } }] });
    // Someone else saved over revision 1 meanwhile.
    run(store, "postmortem.save", {
      id: INC,
      sections: sections({ impact: "All card payments." }),
      baseRevision: 1,
      baseUpdatedAt: T,
    });
    expect(
      run(
        store,
        "postmortem.save",
        { id: INC, sections: sections(), baseRevision: 1, baseUpdatedAt: T },
        responder,
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("postmortems", INC)).toMatchObject({ revision: 2, updatedBy: "usr_ana" });
    // Only the first save is a timeline entry.
    expect(timelineKinds(store)).toEqual(["started"]);
    expect(
      run(
        store,
        "postmortem.save",
        { id: INC, sections: sections(), baseRevision: 0, baseUpdatedAt: 0 },
        viewer,
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("a save queued behind a refused one still conflicts: the base is what the server confirmed", () => {
    const store = shard();
    const save = (patch: Record<string, unknown>, context: MutationContext) =>
      run(store, "postmortem.save", { id: INC, sections: sections(), ...patch }, context);
    save({ baseRevision: 0, baseUpdatedAt: 0 }, owner);
    // A opens revision 1.
    const opened = store.get("postmortems", INC)!;
    expect(opened.revision).toBe(1);
    const base = { baseRevision: opened.revision, baseUpdatedAt: opened.updatedAt };
    // B saves revision 2.
    expect(
      save(
        { ...base, sections: sections({ impact: "B's text" }) },
        ctx("usr_caio", "responder", T + 1000),
      ),
    ).toMatchObject({ ok: true });
    // A saves over revision 1: refused.
    const a = ctx("usr_ana", "owner", T + 2000);
    expect(save({ ...base, sections: sections({ impact: "A's text" }) }, a)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    // A edits again and saves: with the same base, or with the revision A's own optimistic save showed (2, stamped
    // with A's clock), it still conflicts.
    expect(save({ ...base, sections: sections({ impact: "A's text, again" }) }, a)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(
      save({ baseRevision: 2, baseUpdatedAt: T + 2000, sections: sections({ impact: "A" }) }, a),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 2,
      updatedBy: "usr_caio",
      sections: { impact: "B's text" },
    });
    // Loading B's version gives a base that saves.
    expect(
      save({ baseRevision: 2, baseUpdatedAt: T + 1000, sections: sections({ impact: "A" }) }, a),
    ).toMatchObject({ ok: true });
  });

  test("events never carry the text", () => {
    const store = shard();
    const result = run(store, "postmortem.save", {
      id: INC,
      sections: sections(),
      baseRevision: 0,
      baseUpdatedAt: 0,
    });
    expect(JSON.stringify(result)).not.toContain("Checkout failed");
  });

  test("a section has a cap and the text rules", () => {
    const store = shard();
    expect(
      run(store, "postmortem.save", {
        id: INC,
        sections: sections({ rootCause: "x".repeat(3001) }),
        baseRevision: 0,
        baseUpdatedAt: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });

  test("an AI draft is asked for, written as sys_ai and marked until a member saves", () => {
    const store = shard();
    expect(
      server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder),
    ).toMatchObject({ ok: true, events: [{ type: "postmortem.draft_requested" }] });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 0,
      draft: { status: "pending" },
    });
    // One at a time.
    expect(
      server(store, "postmortem.requestDraft", { id: INC, requestId: DRF2 }, responder),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      server(
        store,
        "postmortem.writeDraft",
        { id: INC, requestId: DRF, sections: sections(), model: "@cf/x" },
        ai(),
      ),
    ).toMatchObject({ ok: true, events: [{ type: "postmortem.drafted", data: { revision: 1 } }] });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 1,
      draft: null,
      ai: { model: "@cf/x", by: "usr_caio" },
    });
    // The marker stays until a member saves; asking again may replace an unsaved draft.
    expect(
      server(store, "postmortem.requestDraft", { id: INC, requestId: DRF2 }, responder),
    ).toMatchObject({ ok: true });
    server(store, "postmortem.failDraft", { id: INC, requestId: DRF2, reason: "timeout" }, ai());
    expect(store.get("postmortems", INC)!.draft).toMatchObject({
      status: "failed",
      reason: "timeout",
    });
    run(
      store,
      "postmortem.save",
      { id: INC, sections: sections(), baseRevision: 1, baseUpdatedAt: T },
      responder,
    );
    expect(store.get("postmortems", INC)!.ai).toBeNull();
    // Never over a member's own text.
    expect(
      server(
        store,
        "postmortem.requestDraft",
        { id: INC, requestId: "drf_01JB0000000000000000000003" },
        responder,
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(timelineKinds(store)).toEqual(["ai_drafted"]);
  });

  test("a member's save while the draft runs wins: the draft fails as edited", () => {
    const store = shard();
    server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder);
    run(store, "postmortem.save", {
      id: INC,
      sections: sections(),
      baseRevision: 0,
      baseUpdatedAt: 0,
    });
    expect(
      server(
        store,
        "postmortem.writeDraft",
        { id: INC, requestId: DRF, sections: sections({ summary: "AI" }), model: "m" },
        ai(),
      ),
    ).toMatchObject({
      ok: true,
      events: [{ type: "postmortem.draft_failed", data: { reason: "edited" } }],
    });
    expect(store.get("postmortems", INC)!.sections.summary).toBe("Checkout failed for 20 minutes.");
  });

  test("a stale pending draft may be asked for again", () => {
    const store = shard();
    server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder);
    expect(
      server(
        store,
        "postmortem.requestDraft",
        { id: INC, requestId: DRF2 },
        ctx("usr_caio", "responder", T + AI_DRAFT_STALE_MS),
      ),
    ).toMatchObject({ ok: true });
    // The lost draft's result no longer lands.
    expect(
      server(
        store,
        "postmortem.writeDraft",
        { id: INC, requestId: DRF, sections: sections(), model: "m" },
        ai(),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("a draft that went stale refuses its late result", () => {
    const store = shard();
    server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder);
    expect(
      server(
        store,
        "postmortem.writeDraft",
        { id: INC, requestId: DRF, sections: sections({ summary: "Late" }), model: "m" },
        ai(T + AI_DRAFT_STALE_MS),
      ),
    ).toMatchObject({
      ok: true,
      events: [{ type: "postmortem.draft_failed", data: { reason: "timeout" } }],
    });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 0,
      ai: null,
      sections: EMPTY_SECTIONS,
      draft: { status: "failed", reason: "timeout" },
    });
  });

  test(`at most ${AI_DRAFTS_PER_DAY} drafts a day per workspace`, () => {
    const store = shard();
    let now = T;
    for (let index = 0; index < AI_DRAFTS_PER_DAY; index++) {
      const requestId = `drf_01JD${String(index).padStart(22, "0")}`;
      expect(
        server(
          store,
          "postmortem.requestDraft",
          { id: INC, requestId },
          ctx("usr_caio", "responder", now),
        ),
      ).toMatchObject({ ok: true });
      server(store, "postmortem.failDraft", { id: INC, requestId, reason: "failed" }, ai(now));
      now += 1000;
    }
    expect(
      server(
        store,
        "postmortem.requestDraft",
        { id: INC, requestId: DRF },
        ctx("usr_caio", "responder", now),
      ),
    ).toMatchObject({ ok: false, error: { code: "limit_reached" } });
    expect(
      server(
        store,
        "postmortem.requestDraft",
        { id: INC, requestId: DRF },
        ctx("usr_caio", "responder", T + 25 * 3600_000),
      ),
    ).toMatchObject({ ok: true });
  });

  test("drafting is server only", () => {
    expect(Object.keys(mutations)).not.toContain("postmortem.requestDraft");
    expect(Object.keys(mutations)).not.toContain("postmortem.writeDraft");
  });
});

describe("exports", () => {
  test("the file holds the incident, its timeline, updates, follow-ups and postmortem, and no address", () => {
    const store = shard();
    run(store, "incident.postUpdate", { id: INC, body: "Rolled back the gateway." });
    run(store, "followUp.create", followUp());
    run(store, "postmortem.save", {
      id: INC,
      sections: sections(),
      baseRevision: 0,
      baseUpdatedAt: 0,
    });
    const built = buildExport(store, { kind: "incident", incidentId: INC }, T);
    expect(built.ok).toBe(true);
    const file = (built as { file: Record<string, any> }).file;
    expect(file).toMatchObject({
      format: "brigade.export",
      version: 1,
      workspace: { name: "Acme" },
    });
    const [one] = file.incidents;
    expect(one.incident).toMatchObject({ id: INC, title: "Checkout down" });
    expect(one.updates).toEqual([
      { at: new Date(T).toISOString(), by: "usr_ana", body: "Rolled back the gateway." },
    ]);
    expect(one.followUps).toHaveLength(1);
    expect(one.postmortem.sections.summary).toBe("Checkout failed for 20 minutes.");
    expect(JSON.stringify(file)).not.toContain("@");
  });

  test("a range takes the incidents declared in it, UTC days both included, and has a cap", () => {
    const store = shard();
    const range = (from: string, to: string) => buildExport(store, { kind: "range", from, to }, T);
    expect(range("2026-10-26", "2026-10-26")).toMatchObject({ ok: true, incidents: 1 });
    expect(range("2026-10-27", "2026-10-30")).toMatchObject({ ok: true, incidents: 0 });
    expect(buildExport(store, { kind: "incident", incidentId: INC2 }, T)).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  test("the chunks the shard writes join into the same file", () => {
    const store = shard();
    run(store, "incident.declare", { id: INC2, title: "Search slow" });
    run(store, "incident.postUpdate", { id: INC, body: "Rolled back the gateway." });
    run(store, "followUp.create", followUp());
    const scope = { kind: "range", from: "2026-10-26", to: "2026-10-26" } as const;
    const chunked = exportChunks(store, scope, T);
    const built = buildExport(store, scope, T);
    expect(chunked).toMatchObject({ ok: true, incidents: 2 });
    const text = [...(chunked as { chunks: Iterable<string> }).chunks].join("");
    expect(text).toBe(JSON.stringify((built as { file: unknown }).file));
    const none = exportChunks(store, { kind: "range", from: "2026-10-27", to: "2026-10-27" }, T);
    const empty = JSON.parse([...(none as { chunks: Iterable<string> }).chunks].join("")) as {
      incidents: unknown[];
    };
    expect(empty.incidents).toEqual([]);
  });

  test(`at most ${EXPORTS_PER_HOUR} exports an hour per workspace, server only`, () => {
    const store = shard();
    const id = (index: number) => `exp_01JH${String(index).padStart(22, "0")}`;
    for (let index = 0; index < EXPORTS_PER_HOUR; index++) {
      expect(
        server(store, "export.reserve", { id: id(index) }, ctx("usr_ana", "owner", T + index)),
      ).toMatchObject({ ok: true, events: [] });
    }
    expect(server(store, "export.reserve", { id: id(99) })).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
    expect(server(store, "export.reserve", { id: id(99) }, responder)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      server(
        store,
        "export.reserve",
        { id: id(99) },
        ctx("usr_ana", "owner", T + EXPORT_WINDOW_MS),
      ),
    ).toMatchObject({ ok: true });
    expect(store.scan("export_ledger")).toHaveLength(EXPORTS_PER_HOUR);
    expect(Object.keys(mutations)).not.toContain("export.reserve");
  });

  test("owners and admins record exports; the list drops expired and old ones", () => {
    const store = shard();
    const args = (id: string) => ({
      id,
      scope: { kind: "range", from: "2026-10-01", to: "2026-10-31" },
      incidents: 1,
      bytes: 100,
    });
    expect(server(store, "export.record", args(EXP), responder)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(server(store, "export.record", args(EXP))).toMatchObject({
      ok: true,
      events: [{ type: "workspace.exported", data: { expiresAt: T + EXPORT_TTL_MS } }],
    });
    expect(
      server(store, "export.record", {
        ...args(EXP),
        scope: { kind: "range", from: "2026-10-31", to: "2026-10-01" },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    for (let index = 0; index < MAX_LISTED_EXPORTS + 3; index++) {
      server(
        store,
        "export.record",
        args(`exp_01JE${String(index).padStart(22, "0")}`),
        ctx("usr_ana", "owner", T + index),
      );
    }
    expect(store.scan("exports")).toHaveLength(MAX_LISTED_EXPORTS);
    server(
      store,
      "export.record",
      args("exp_01JF0000000000000000000001"),
      ctx("usr_ana", "owner", T + EXPORT_TTL_MS + 100),
    );
    expect(store.scan("exports")).toHaveLength(1);
    expect(runQuery(queries, "exports.recent", {}, store, "responder")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
