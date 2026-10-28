// Postmortem templates (RFC 0013 "Templates"): who sets them, their caps, which one a new postmortem takes, and that a
// postmortem keeps the sections it was made with whatever the templates or its incident's type become.
import { describe, expect, test } from "vite-plus/test";
import {
  AI_ACTOR,
  BUILTIN_LAYOUT,
  buildExport,
  createMemoryStore,
  EMPTY_SECTIONS,
  MAX_TEMPLATE_SECTIONS,
  mutations,
  POSTMORTEM_SECTION_MAX,
  postmortemLayout,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TEMPLATE_STARTER_MAX,
  type BrigadeTables,
  type MutationContext,
  type MutationStore,
  type PostmortemTemplateSection,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);
const INC = "inc_01JB0000000000000000000001";
const INC2 = "inc_01JB0000000000000000000002";
const TYP = "typ_01JB0000000000000000000001";
const TYP2 = "typ_01JB0000000000000000000002";
const DRF = "drf_01JB0000000000000000000001";

const ctx = (id: string, role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id, role },
  now,
  server: true,
});
const owner = ctx("usr_ana", "owner");
const admin = ctx("usr_bia", "admin");
const responder = ctx("usr_caio", "responder");
const viewer = ctx("usr_duda", "viewer");

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_bia", "admin"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  store.insert("workspace", { id: "ws_x", name: "Acme", createdAt: 0, createdBy: "usr_ana" });
  run(store, "incident.declare", { id: INC, title: "Checkout down", severity: "sev1" });
  for (const id of [TYP, TYP2]) {
    run(store, "incidentType.create", {
      id,
      name: id === TYP ? "Payments" : "Security",
      description: "",
      defaultSeverity: null,
      escalationPolicyId: null,
      requiredFields: [],
    });
  }
  return store;
}

const run = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(mutations, name, args, store, context);
const server = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(serverMutations, name, args, store, context);

const section = (
  key: PostmortemTemplateSection["key"],
  patch: Partial<PostmortemTemplateSection> = {},
): PostmortemTemplateSection => ({ key, title: "", hint: "", starter: "", ...patch });

const payments = [
  section("summary", { starter: "Customer-facing:\nInternal:" }),
  section("custom1", { title: "Card network contact", hint: "Who we called at the card network" }),
  section("rootCause", { title: "Why it broke" }),
];
const fallback = [section("summary"), section("followUps")];

const save = (
  store: MutationStore,
  sections: Record<string, string>,
  base = { baseRevision: 0, baseUpdatedAt: 0 },
  context = responder,
  id = INC,
) => run(store, "postmortem.save", { id, sections, ...base }, context);

describe("setting a template", () => {
  test("owners and admins set and reset one; responders and viewers cannot", () => {
    const store = shard();
    expect(
      run(store, "postmortemTemplate.set", { id: TYP, sections: payments }, responder),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      run(store, "postmortemTemplate.set", { id: TYP, sections: payments }, viewer),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(run(store, "postmortemTemplate.set", { id: TYP, sections: payments })).toMatchObject({
      ok: true,
      events: [
        {
          type: "postmortem_template.updated",
          data: { id: TYP, typeId: TYP, sections: 3, custom: 1 },
        },
      ],
    });
    expect(
      run(store, "postmortemTemplate.set", { id: "default", sections: fallback }, admin),
    ).toMatchObject({
      ok: true,
      events: [{ data: { id: "default", typeId: null, sections: 2, custom: 0 } }],
    });
    // Everyone who reads the catalog reads them: the postmortem editor needs them.
    const read = runQuery(queries, "postmortemTemplates.all", {}, store, "viewer");
    expect(read.ok && read.rows.map((row) => (row as { id: string }).id).sort()).toEqual(
      ["default", TYP].sort(),
    );
    expect(run(store, "postmortemTemplate.set", { id: TYP, sections: payments })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, "postmortemTemplate.reset", { id: TYP }, responder)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(run(store, "postmortemTemplate.reset", { id: TYP })).toMatchObject({
      ok: true,
      events: [{ type: "postmortem_template.reset", data: { id: TYP, typeId: TYP } }],
    });
    expect(run(store, "postmortemTemplate.reset", { id: TYP })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("its caps: sections, keys, titles, hints and starter text", () => {
    const store = shard();
    const set = (sections: unknown, id = TYP) =>
      run(store, "postmortemTemplate.set", { id, sections });
    const invalid = { ok: false, error: { code: "invalid_args" } };
    expect(set([])).toMatchObject(invalid);
    expect(set([section("summary"), section("summary")])).toMatchObject(invalid);
    // A custom section needs a title; a built-in may keep its own name.
    expect(set([section("custom1")])).toMatchObject(invalid);
    expect(set([section("custom4" as "custom1", { title: "Fourth" })])).toMatchObject(invalid);
    expect(set([section("summary", { title: "x".repeat(61) })])).toMatchObject(invalid);
    expect(set([section("summary", { hint: "x".repeat(301) })])).toMatchObject(invalid);
    expect(
      set([section("summary", { starter: "x".repeat(TEMPLATE_STARTER_MAX + 1) })]),
    ).toMatchObject(invalid);
    expect(set([section("summary")], "typ_nope")).toMatchObject(invalid);
    expect(set([section("summary")], "typ_01JB0000000000000000000009")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    // Every built-in and every custom section at once is the most a template holds.
    const all = [
      ...BUILTIN_LAYOUT,
      section("custom1", { title: "One" }),
      section("custom2", { title: "Two" }),
      section("custom3", { title: "Three" }),
    ];
    expect(all).toHaveLength(MAX_TEMPLATE_SECTIONS);
    expect(set(all)).toMatchObject({ ok: true });
  });

  test("deleting a type deletes its template: its incidents fall back to the default", () => {
    const store = shard();
    run(store, "postmortemTemplate.set", { id: TYP, sections: payments });
    run(store, "postmortemTemplate.set", { id: "default", sections: fallback });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    run(store, "incidentType.delete", { id: TYP });
    expect(store.get("postmortem_templates", TYP)).toBeUndefined();
    const get = (id: string) => store.get("postmortem_templates", id);
    expect(postmortemLayout(undefined, get, store.get("incidents", INC)!)).toEqual(fallback);
  });
});

describe("a postmortem takes its template", () => {
  test("with no template, a postmortem has the seven built-in sections, as before", () => {
    const store = shard();
    expect(save(store, { ...EMPTY_SECTIONS, summary: "Down." })).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC)).toMatchObject({ layout: null });
    const get = (id: string) => store.get("postmortem_templates", id);
    expect(postmortemLayout(store.get("postmortems", INC), get, { typeId: null })).toEqual(
      BUILTIN_LAYOUT,
    );
  });

  test("a postmortem from before templates keeps its seven sections, whatever the templates say", () => {
    const store = shard();
    // As rows were written before templates: no `layout` at all.
    store.insert("postmortems", {
      id: INC,
      sections: { ...EMPTY_SECTIONS, summary: "Down." },
      revision: 1,
      ai: null,
      draft: null,
      createdAt: T,
      updatedAt: T,
      updatedBy: "usr_ana",
    });
    run(store, "postmortemTemplate.set", { id: "default", sections: fallback });
    const get = (id: string) => store.get("postmortem_templates", id);
    expect(postmortemLayout(store.get("postmortems", INC), get, { typeId: null })).toEqual(
      BUILTIN_LAYOUT,
    );
    expect(
      save(
        store,
        { ...EMPTY_SECTIONS, summary: "Down for 20 minutes." },
        {
          baseRevision: 1,
          baseUpdatedAt: T,
        },
      ),
    ).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 2,
      sections: { summary: "Down for 20 minutes.", impact: "" },
    });
    // The template's sections are not this postmortem's.
    expect(
      save(store, { summary: "x", followUps: "" }, { baseRevision: 2, baseUpdatedAt: T }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });

  test("its type's template, else the default; and keeps it after template edits and type changes", () => {
    const store = shard();
    run(store, "postmortemTemplate.set", { id: TYP, sections: payments });
    run(store, "postmortemTemplate.set", { id: "default", sections: fallback });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    run(store, "incident.declare", { id: INC2, title: "Search slow", severity: "sev3" });
    // The seven built-in sections are not this incident's.
    expect(save(store, { ...EMPTY_SECTIONS, summary: "Down." })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(
      save(store, { summary: "Down.", custom1: "Called at 12:05.", rootCause: "" }),
    ).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC)).toMatchObject({
      layout: payments,
      sections: { summary: "Down.", custom1: "Called at 12:05.", rootCause: "" },
    });
    // No type: the default.
    expect(
      save(store, { summary: "Slow.", followUps: "" }, undefined, responder, INC2),
    ).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC2)).toMatchObject({ layout: fallback });

    // Later edits to the template, and another type, leave it as it was made.
    run(store, "postmortemTemplate.set", { id: TYP, sections: [section("impact")] });
    run(store, "incident.setType", { id: INC, typeId: TYP2 });
    run(store, "postmortemTemplate.reset", { id: "default" });
    expect(store.get("postmortems", INC)).toMatchObject({ layout: payments });
    expect(store.get("postmortems", INC2)).toMatchObject({ layout: fallback });
    const base = { baseRevision: 1, baseUpdatedAt: T };
    expect(
      save(store, { summary: "Down 20 min.", custom1: "Called at 12:05.", rootCause: "" }, base),
    ).toMatchObject({ ok: true });
  });

  test("a postmortem nobody wrote in follows its incident's new type; one with text keeps its sections", () => {
    const store = shard();
    run(store, "postmortemTemplate.set", { id: TYP, sections: payments });
    run(store, "postmortemTemplate.set", { id: TYP2, sections: fallback });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    // A draft that failed made the row: still blank, so it follows the type.
    server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder);
    server(
      store,
      "postmortem.failDraft",
      { id: INC, requestId: DRF, reason: "failed" },
      { actor: AI_ACTOR, now: T, server: true },
    );
    expect(store.get("postmortems", INC)).toMatchObject({ revision: 0, layout: payments });
    const later = ctx("usr_ana", "owner", T + 1000);
    expect(run(store, "incident.setType", { id: INC, typeId: TYP2 }, later)).toMatchObject({
      ok: true,
    });
    expect(store.get("postmortems", INC)).toMatchObject({
      layout: fallback,
      sections: { summary: "", followUps: "" },
      updatedAt: T + 1000,
    });
    // An editor opened on the old sections is refused as a conflict and offered the new ones.
    expect(save(store, { summary: "Down.", custom1: "", rootCause: "" })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    // No type: the built-in sections.
    run(store, "incident.setType", { id: INC, typeId: null });
    expect(store.get("postmortems", INC)).toMatchObject({ layout: null });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    // Starter text alone is still blank.
    const starter = { summary: "Customer-facing:\nInternal:", custom1: "", rootCause: "" };
    store.update("postmortems", INC, { sections: starter });
    run(store, "incident.setType", { id: INC, typeId: TYP2 });
    expect(store.get("postmortems", INC)).toMatchObject({ layout: fallback });
    // Once a member wrote in it, it keeps its sections.
    const written = store.get("postmortems", INC)!;
    expect(
      save(
        store,
        { summary: "Down.", followUps: "" },
        {
          baseRevision: written.revision,
          baseUpdatedAt: written.updatedAt,
        },
      ),
    ).toMatchObject({ ok: true });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    expect(store.get("postmortems", INC)).toMatchObject({
      layout: fallback,
      sections: { summary: "Down.", followUps: "" },
    });
  });

  test("a section and the whole document have caps", () => {
    const store = shard();
    const all = [
      ...BUILTIN_LAYOUT,
      section("custom1", { title: "One" }),
      section("custom2", { title: "Two" }),
      section("custom3", { title: "Three" }),
    ];
    run(store, "postmortemTemplate.set", { id: "default", sections: all });
    const full = Object.fromEntries(
      all.map(({ key }) => [key, "x".repeat(POSTMORTEM_SECTION_MAX)]),
    );
    expect(save(store, full)).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    const fits = Object.fromEntries(all.map(({ key }) => [key, "x".repeat(2100)]));
    expect(save(store, fits)).toMatchObject({ ok: true });
    // The most a save can hold, every character escaped in JSON, stays inside RFC 0004's client frame (65,536).
    const quotes = Object.fromEntries(all.map(({ key }) => [key, '"'.repeat(2100)]));
    const frame = JSON.stringify({
      type: "mutate",
      mutationId: "m".repeat(64),
      clientId: "c".repeat(64),
      name: "postmortem.save",
      args: { id: INC, sections: quotes, baseRevision: Number.MAX_SAFE_INTEGER, baseUpdatedAt: T },
    });
    expect(frame.length).toBeLessThan(65_536);
  });

  test("an AI draft takes the template when it makes the postmortem, and fills only its sections", () => {
    const store = shard();
    run(store, "postmortemTemplate.set", { id: TYP, sections: payments });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    expect(
      server(store, "postmortem.requestDraft", { id: INC, requestId: DRF }, responder),
    ).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC)).toMatchObject({
      revision: 0,
      layout: payments,
      sections: { summary: "", custom1: "", rootCause: "" },
    });
    const ai = { actor: AI_ACTOR, now: T + 1000, server: true };
    expect(
      server(
        store,
        "postmortem.writeDraft",
        { id: INC, requestId: DRF, sections: EMPTY_SECTIONS, model: "m" },
        ai,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(
      server(
        store,
        "postmortem.writeDraft",
        {
          id: INC,
          requestId: DRF,
          sections: { summary: "Down.", custom1: "Called.", rootCause: "Unknown." },
          model: "m",
        },
        ai,
      ),
    ).toMatchObject({ ok: true });
    expect(store.get("postmortems", INC)).toMatchObject({ revision: 1, layout: payments });
  });
});

describe("exports", () => {
  test("hold the sections in the template's order, with their titles", () => {
    const store = shard();
    run(store, "postmortemTemplate.set", { id: TYP, sections: payments });
    run(store, "incident.setType", { id: INC, typeId: TYP });
    save(store, { rootCause: "Expired cert.", custom1: "Called.", summary: "Down." });
    const built = buildExport(store, { kind: "incident", incidentId: INC }, T);
    const file = (built as { file: { incidents: { postmortem: Record<string, unknown> }[] } }).file;
    const postmortem = file.incidents[0]!.postmortem;
    expect(postmortem.layout).toEqual([
      { key: "summary", title: null },
      { key: "custom1", title: "Card network contact" },
      { key: "rootCause", title: "Why it broke" },
    ]);
    expect(Object.keys(postmortem.sections as object)).toEqual(["summary", "custom1", "rootCause"]);
  });

  test("a postmortem with no template keeps the seven sections in their order", () => {
    const store = shard();
    save(store, { ...EMPTY_SECTIONS, summary: "Down." });
    const built = buildExport(store, { kind: "incident", incidentId: INC }, T);
    const file = (built as { file: { incidents: { postmortem: Record<string, unknown> }[] } }).file;
    expect(Object.keys(file.incidents[0]!.postmortem.sections as object)).toEqual(
      Object.keys(EMPTY_SECTIONS),
    );
  });
});
