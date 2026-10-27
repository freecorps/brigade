// The catalog (RFC 0003 "Service catalog", "Incident types", "Custom fields"): who defines it, what it may point
// at, references that go away, declaring with a type, setting an incident's type, services and fields, and the
// policy an incident's pages use (RFC 0006 "Who is paged").
import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  ESCALATION_ACTOR,
  liveValue,
  MAX_CUSTOM_FIELDS_PER_WORKSPACE,
  MAX_SERVICES_PER_WORKSPACE,
  MEMBERS_ACTOR,
  missingFields,
  mutations,
  runMutation,
  serverMutations,
  type BrigadeTables,
  type MutationContext,
  type MutationStore,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);

const SVC = "svc_01JB0000000000000000000001";
const SVC2 = "svc_01JB0000000000000000000002";
const TYP = "typ_01JB0000000000000000000001";
const FLD_TEXT = "fld_01JB0000000000000000000001";
const FLD_ONE = "fld_01JB0000000000000000000002";
const FLD_MANY = "fld_01JB0000000000000000000003";
const FLD_NUM = "fld_01JB0000000000000000000004";
const FLD_LINK = "fld_01JB0000000000000000000005";
const OPT_A = "opt_01JB0000000000000000000001";
const OPT_B = "opt_01JB0000000000000000000002";
const OPT_C = "opt_01JB0000000000000000000003";
const ESC = "esc_01JB0000000000000000000001";
const ESC_DEFAULT = "esc_01JB0000000000000000000002";
const LVL = "lvl_01JB0000000000000000000001";
const SCH = "sch_01JB0000000000000000000001";
const INC = "inc_01JB0000000000000000000001";
const INC2 = "inc_01JB0000000000000000000002";
const EVT = "evt_01JB0000000000000000000001";

const ctx = (id: string, role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id, role },
  now,
  server: true,
});
const owner = ctx("usr_ana", "owner");
const responder = ctx("usr_caio", "responder");

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_bia", "admin"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
    ["usr_eva", "responder"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  store.insert("schedules", {
    id: SCH,
    name: "Primary",
    timeZone: "UTC",
    layers: [],
    createdAt: 0,
    createdBy: "usr_ana",
    updatedAt: 0,
  });
  return store;
}

const run = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(mutations, name, args, store, context);

const policy = (id: string, isDefault: boolean, target = "usr_eva") => ({
  id,
  name: id === ESC ? "Payments" : "Everyone",
  levels: [{ id: LVL, targets: [{ kind: "member", id: target }], timeoutMinutes: 5 }],
  repeat: 0,
  isDefault,
});

const service = (patch: Record<string, unknown> = {}) => ({
  id: SVC,
  name: "Checkout",
  description: "Takes the money.",
  tier: "tier1",
  owners: [{ kind: "schedule", id: SCH }],
  escalationPolicyId: null,
  ...patch,
});

const field = (id: string, kind: string, options: { id: string; label: string }[] = []) => ({
  id,
  name: `Field ${kind}`,
  description: "",
  kind,
  options,
});

const type = (patch: Record<string, unknown> = {}) => ({
  id: TYP,
  name: "Payments outage",
  description: "",
  defaultSeverity: "sev1",
  escalationPolicyId: null,
  requiredFields: [],
  ...patch,
});

/** A shard with every kind of field, a type and two services. */
function catalog() {
  const store = shard();
  for (const args of [
    field(FLD_TEXT, "text"),
    field(FLD_ONE, "single_select", [
      { id: OPT_A, label: "Card" },
      { id: OPT_B, label: "Pix" },
    ]),
    field(FLD_MANY, "multi_select", [
      { id: OPT_A, label: "iOS" },
      { id: OPT_B, label: "Android" },
      { id: OPT_C, label: "Web" },
    ]),
    field(FLD_NUM, "number"),
    field(FLD_LINK, "link"),
  ]) {
    expect(run(store, "customField.create", args)).toMatchObject({ ok: true });
  }
  expect(run(store, "service.create", service())).toMatchObject({ ok: true });
  expect(
    run(store, "service.create", service({ id: SVC2, name: "Search", tier: "tier3" })),
  ).toMatchObject({
    ok: true,
  });
  expect(run(store, "incidentType.create", type({ requiredFields: [FLD_ONE] }))).toMatchObject({
    ok: true,
  });
  return store;
}

const declare = (store: MutationStore, args: Record<string, unknown> = {}, id = INC) =>
  run(store, "incident.declare", { id, title: "Card payments fail", ...args }, responder);

const entries = (store: MutationStore) =>
  store.scan("timeline").map((row) => {
    const { id: _id, incidentId: _incident, seq: _seq, at: _at, actor: _actor, ...entry } = row;
    return entry;
  });

describe("defining the catalog", () => {
  test("owners and admins define services, types and fields; responders and viewers only read", () => {
    for (const role of ["responder", "viewer"] as const) {
      const store = shard();
      const as = ctx("usr_caio", role);
      expect(run(store, "service.create", service(), as)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(run(store, "incidentType.create", type(), as)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
      expect(run(store, "customField.create", field(FLD_TEXT, "text"), as)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    const store = shard();
    expect(run(store, "service.create", service(), ctx("usr_bia", "admin"))).toEqual({
      ok: true,
      events: [
        {
          type: "service.created",
          subject: SVC,
          data: { id: SVC, name: "Checkout", tier: "tier1", owners: 1, escalationPolicyId: null },
        },
      ],
    });
  });

  test("a service's owners exist and can respond, once each; its policy exists", () => {
    const store = shard();
    const refused = run(
      store,
      "service.create",
      service({
        owners: [
          { kind: "schedule", id: "sch_01JB0000000000000000000009" },
          { kind: "member", id: "usr_duda" },
          { kind: "member", id: "usr_nobody" },
          { kind: "member", id: "usr_eva" },
          { kind: "member", id: "usr_eva" },
        ],
        escalationPolicyId: ESC,
      }),
    );
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: "invalid_args",
        issues: [
          { path: "owners[0]", message: "Schedule not found" },
          { path: "owners[1]", message: "Viewers cannot own services" },
          { path: "owners[2]", message: "Not a member" },
          { path: "owners[4]", message: "Listed twice" },
          { path: "escalationPolicyId", message: "Policy not found" },
        ],
      },
    });
    expect(store.scan("services")).toEqual([]);
  });

  test("an unchanged edit is a conflict, and the caps hold", () => {
    const store = shard();
    expect(run(store, "service.create", service())).toMatchObject({ ok: true });
    expect(run(store, "service.update", service())).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, "service.update", service({ tier: "tier2" }))).toMatchObject({
      ok: true,
      events: [{ type: "service.updated", data: { reason: "edited", tier: "tier2" } }],
    });
    for (let i = 1; i < MAX_SERVICES_PER_WORKSPACE; i++) {
      store.insert("services", { ...store.get("services", SVC)!, id: `svc_x${i}` });
    }
    expect(run(store, "service.create", service({ id: SVC2 }))).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
    for (let i = 0; i < MAX_CUSTOM_FIELDS_PER_WORKSPACE; i++) {
      store.insert("custom_fields", {
        id: `fld_x${i}`,
        name: "x",
        description: "",
        kind: "text",
        options: [],
        createdAt: 0,
        createdBy: "usr_ana",
        updatedAt: 0,
      });
    }
    expect(run(store, "customField.create", field(FLD_TEXT, "text"))).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test("select fields need options, listed once; other kinds take none; the kind never changes", () => {
    const store = shard();
    expect(run(store, "customField.create", field(FLD_ONE, "single_select"))).toMatchObject({
      ok: false,
      error: { issues: [{ path: "options", message: "Add at least one option" }] },
    });
    expect(
      run(
        store,
        "customField.create",
        field(FLD_ONE, "multi_select", [
          { id: OPT_A, label: "iOS" },
          { id: OPT_B, label: "ios" },
        ]),
      ),
    ).toMatchObject({ ok: false, error: { issues: [{ path: "options[1].label" }] } });
    expect(
      run(store, "customField.create", field(FLD_TEXT, "text", [{ id: OPT_A, label: "x" }])),
    ).toMatchObject({ ok: false, error: { issues: [{ path: "options" }] } });
    expect(run(store, "customField.create", field(FLD_TEXT, "text"))).toMatchObject({ ok: true });
    expect(run(store, "customField.update", field(FLD_TEXT, "number"))).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "kind", message: "Unknown key" }] },
    });
  });

  test("a type's required fields and policy must exist", () => {
    const store = shard();
    expect(
      run(
        store,
        "incidentType.create",
        type({ requiredFields: [FLD_TEXT], escalationPolicyId: ESC }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        issues: [
          { path: "escalationPolicyId", message: "Policy not found" },
          { path: "requiredFields[0]", message: "Field not found" },
        ],
      },
    });
  });
});

describe("references that go away", () => {
  test("a deleted policy is unset on every service and type, with an event each", () => {
    const store = catalog();
    expect(run(store, "escalation.createPolicy", policy(ESC, false))).toMatchObject({ ok: true });
    run(store, "service.update", service({ escalationPolicyId: ESC }));
    run(store, "incidentType.update", type({ requiredFields: [FLD_ONE], escalationPolicyId: ESC }));
    expect(run(store, "escalation.deletePolicy", { id: ESC })).toMatchObject({
      ok: true,
      events: [
        { type: "escalation_policy.deleted" },
        { type: "service.updated", subject: SVC, data: { reason: "policy_deleted", ref: ESC } },
        {
          type: "incident_type.updated",
          subject: TYP,
          data: { reason: "policy_deleted", ref: ESC },
        },
      ],
    });
    expect(store.get("services", SVC)!.escalationPolicyId).toBeNull();
    expect(store.get("incident_types", TYP)!.escalationPolicyId).toBeNull();
  });

  test("a deleted schedule and a removed member stop owning services", () => {
    const store = catalog();
    run(
      store,
      "service.update",
      service({
        owners: [
          { kind: "schedule", id: SCH },
          { kind: "member", id: "usr_eva" },
        ],
      }),
    );
    const deleted = run(store, "schedule.delete", { id: SCH });
    expect(deleted.ok && deleted.events.map((event) => event.type)).toEqual([
      "schedule.deleted",
      // Both services were owned by the schedule.
      "service.updated",
      "service.updated",
    ]);
    const removed = runMutation(
      serverMutations,
      "member.changeRole",
      { id: "usr_eva", from: "responder", to: "viewer" },
      store,
      { ...owner, actor: MEMBERS_ACTOR },
    );
    expect(removed).toMatchObject({ ok: true });
    expect(store.get("services", SVC)!.owners).toEqual([]);
  });

  test("a deleted field leaves the types that required it, and its values fade", () => {
    const store = catalog();
    declare(store, { typeId: TYP });
    run(
      store,
      "incident.setField",
      { id: INC, fieldId: FLD_TEXT, value: "Gateway timeouts" },
      responder,
    );
    expect(run(store, "customField.delete", { id: FLD_ONE })).toMatchObject({
      ok: true,
      events: [
        { type: "custom_field.deleted" },
        { type: "incident_type.updated", data: { reason: "field_deleted", ref: FLD_ONE } },
      ],
    });
    expect(store.get("incident_types", TYP)!.requiredFields).toEqual([]);
    run(store, "customField.delete", { id: FLD_TEXT });
    // The stale value goes with the incident's next field write.
    run(store, "incident.setField", { id: INC, fieldId: FLD_NUM, value: 3 }, responder);
    expect(store.get("incidents", INC)!.fields).toEqual({ [FLD_NUM]: 3 });
  });
});

describe("incidents", () => {
  test("declaring with a type takes its default severity unless one is given, and names services", () => {
    const store = catalog();
    expect(declare(store, { typeId: TYP, serviceIds: [SVC] })).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)).toMatchObject({
      severity: "sev1",
      typeId: TYP,
      serviceIds: [SVC],
    });
    declare(store, { typeId: TYP, severity: "sev4" }, INC2);
    expect(store.get("incidents", INC2)!.severity).toBe("sev4");
  });

  test("a declare without a severity or type is a SEV3, and old clients still declare", () => {
    const store = catalog();
    expect(declare(store)).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)).toMatchObject({ severity: "sev3" });
    expect(store.get("incidents", INC)).not.toHaveProperty("typeId");
    expect(store.get("incidents", INC)).not.toHaveProperty("serviceIds");
  });

  test("a type or service deleted while a declare waited is left out, never refused", () => {
    const store = catalog();
    run(store, "incidentType.delete", { id: TYP });
    run(store, "service.delete", { id: SVC });
    expect(declare(store, { typeId: TYP, serviceIds: [SVC, SVC2] })).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)).toMatchObject({ severity: "sev3", serviceIds: [SVC2] });
    expect(store.get("incidents", INC)).not.toHaveProperty("typeId");
  });

  test("changing the type is a timeline entry by name, and changes nothing else", () => {
    const store = catalog();
    declare(store, { severity: "sev2" });
    expect(run(store, "incident.setType", { id: INC, typeId: TYP }, responder)).toEqual({
      ok: true,
      events: [{ type: "incident.type_changed", subject: INC, data: { from: null, to: TYP } }],
    });
    expect(store.get("incidents", INC)!.severity).toBe("sev2");
    expect(run(store, "incident.setType", { id: INC, typeId: TYP }, responder)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    run(store, "incident.setType", { id: INC, typeId: null }, responder);
    expect(entries(store).slice(1)).toEqual([
      { kind: "type_changed", from: null, to: "Payments outage" },
      { kind: "type_changed", from: "Payments outage", to: null },
    ]);
    expect(
      run(store, "incident.setType", { id: INC, typeId: TYP }, ctx("usr_duda", "viewer")),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("services are replaced as a list, every one existing, the change by name", () => {
    const store = catalog();
    declare(store, { serviceIds: [SVC] });
    expect(
      run(store, "incident.setServices", { id: INC, serviceIds: [SVC2, SVC] }, responder),
    ).toMatchObject({
      ok: true,
      events: [{ data: { serviceIds: [SVC2, SVC], added: [SVC2], removed: [] } }],
    });
    expect(
      run(store, "incident.setServices", { id: INC, serviceIds: [SVC] }, responder),
    ).toMatchObject({ ok: true });
    expect(
      run(store, "incident.setServices", { id: INC, serviceIds: [SVC] }, responder),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      run(store, "incident.setServices", { id: INC, serviceIds: [SVC, SVC] }, responder),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(
      run(
        store,
        "incident.setServices",
        { id: INC, serviceIds: ["svc_01JB0000000000000000000009"] },
        responder,
      ),
    ).toMatchObject({ ok: false, error: { issues: [{ message: "Service not found" }] } });
    expect(entries(store).slice(1)).toEqual([
      { kind: "services_changed", added: ["Search"], removed: [] },
      { kind: "services_changed", added: [], removed: ["Search"] },
    ]);
  });

  test("each kind of field takes only its own values", () => {
    const store = catalog();
    declare(store);
    const set = (fieldId: string, value: unknown) =>
      run(store, "incident.setField", { id: INC, fieldId, value }, responder);
    expect(set(FLD_TEXT, "Gateway timeouts")).toMatchObject({ ok: true });
    expect(set(FLD_TEXT, 3)).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(set(FLD_TEXT, "x".repeat(501))).toMatchObject({ ok: false });
    expect(set(FLD_NUM, 12.5)).toMatchObject({ ok: true });
    expect(set(FLD_NUM, "12")).toMatchObject({ ok: false });
    expect(set(FLD_NUM, Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
    expect(set(FLD_LINK, "https://example.com/runbook")).toMatchObject({ ok: true });
    expect(set(FLD_LINK, "javascript:alert(1)")).toMatchObject({ ok: false });
    expect(set(FLD_LINK, "example.com")).toMatchObject({ ok: false });
    expect(set(FLD_ONE, OPT_B)).toMatchObject({ ok: true });
    expect(set(FLD_ONE, [OPT_A])).toMatchObject({ ok: false });
    expect(set(FLD_ONE, OPT_C)).toMatchObject({
      ok: false,
      error: { issues: [{ message: "Option not found" }] },
    });
    expect(set(FLD_MANY, [OPT_A, OPT_C])).toMatchObject({ ok: true });
    expect(set(FLD_MANY, OPT_A)).toMatchObject({ ok: false });
    expect(set(FLD_MANY, [])).toMatchObject({ ok: false });
    expect(set(FLD_MANY, [OPT_A, OPT_C])).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(set("fld_01JB0000000000000000000009", "x")).toMatchObject({
      ok: false,
      error: { issues: [{ path: "fieldId" }] },
    });
    expect(store.get("incidents", INC)!.fields).toEqual({
      [FLD_TEXT]: "Gateway timeouts",
      [FLD_NUM]: 12.5,
      [FLD_LINK]: "https://example.com/runbook",
      [FLD_ONE]: OPT_B,
      [FLD_MANY]: [OPT_A, OPT_C],
    });
    // Selects read by label as they were, so a later rename or delete leaves the entry readable.
    expect(entries(store).slice(-2)).toEqual([
      {
        kind: "field_changed",
        field: "Field single_select",
        fieldKind: "single_select",
        value: null,
        labels: ["Pix"],
      },
      {
        kind: "field_changed",
        field: "Field multi_select",
        fieldKind: "multi_select",
        value: null,
        labels: ["iOS", "Web"],
      },
    ]);
  });

  test("a required field can change but not be cleared; nothing else waits on it", () => {
    const store = catalog();
    declare(store, { typeId: TYP });
    const fields = store.scan("custom_fields");
    const types = store.scan("incident_types");
    expect(missingFields(store.get("incidents", INC)!, types, fields).map((one) => one.id)).toEqual(
      [FLD_ONE],
    );
    // Resolving does not wait for paperwork.
    expect(
      run(store, "incident.setStatus", { id: INC, status: "resolved" }, responder),
    ).toMatchObject({
      ok: true,
    });
    run(store, "incident.setField", { id: INC, fieldId: FLD_ONE, value: OPT_A }, responder);
    expect(missingFields(store.get("incidents", INC)!, types, fields)).toEqual([]);
    expect(
      run(store, "incident.setField", { id: INC, fieldId: FLD_ONE, value: null }, responder),
    ).toMatchObject({
      ok: false,
      error: { issues: [{ path: "value", message: "Required by the incident's type" }] },
    });
    expect(
      run(store, "incident.setField", { id: INC, fieldId: FLD_ONE, value: OPT_B }, responder),
    ).toMatchObject({ ok: true });
  });

  test("an option taken out of a field stops counting in values that hold it", () => {
    const store = catalog();
    declare(store, { typeId: TYP });
    run(store, "incident.setField", { id: INC, fieldId: FLD_ONE, value: OPT_B }, responder);
    run(store, "customField.update", {
      id: FLD_ONE,
      name: "Method",
      description: "",
      options: [{ id: OPT_A, label: "Card" }],
    });
    const fieldRow = store.get("custom_fields", FLD_ONE)!;
    expect(liveValue(fieldRow, store.get("incidents", INC)!.fields![FLD_ONE])).toBeNull();
    expect(
      missingFields(store.get("incidents", INC)!, store.scan("incident_types"), [fieldRow]).length,
    ).toBe(1);
  });
});

describe("the policy an incident's pages use", () => {
  const start = (store: MutationStore) =>
    runMutation(
      serverMutations,
      "escalation.start",
      { incidentId: INC, eventId: EVT, causedBy: "usr_ana" },
      store,
      { actor: ESCALATION_ACTOR, now: T, server: true },
    );

  test("its type's policy, else the default, else none (the interim rule pages)", () => {
    const store = catalog();
    run(store, "escalation.createPolicy", policy(ESC, false, "usr_eva"));
    run(store, "escalation.createPolicy", policy(ESC_DEFAULT, true, "usr_caio"));
    run(store, "incidentType.update", type({ requiredFields: [FLD_ONE], escalationPolicyId: ESC }));
    declare(store, { typeId: TYP });
    expect(start(store)).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)!.escalation).toMatchObject({
      policyId: ESC,
      policyName: "Payments",
    });
  });

  test("a type whose policy was deleted pages through the default", () => {
    const store = catalog();
    run(store, "escalation.createPolicy", policy(ESC, false));
    run(store, "escalation.createPolicy", policy(ESC_DEFAULT, true, "usr_caio"));
    run(store, "incidentType.update", type({ requiredFields: [FLD_ONE], escalationPolicyId: ESC }));
    run(store, "escalation.deletePolicy", { id: ESC });
    declare(store, { typeId: TYP });
    expect(start(store)).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)!.escalation).toMatchObject({ policyId: ESC_DEFAULT });
  });

  test("a type's policy pages even without a default; with neither, nothing starts", () => {
    const store = catalog();
    run(store, "escalation.createPolicy", policy(ESC, false));
    declare(store);
    expect(start(store)).toMatchObject({ ok: false, error: { code: "not_found" } });
    run(store, "incidentType.update", type({ requiredFields: [FLD_ONE], escalationPolicyId: ESC }));
    run(store, "incident.setType", { id: INC, typeId: TYP }, responder);
    expect(start(store)).toMatchObject({ ok: true });
    expect(store.get("incidents", INC)!.escalation).toMatchObject({ policyId: ESC });
  });
});
