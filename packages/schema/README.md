# @freecorps/brigade-schema

Shared domain types and rules used by the API (Workers), the web dashboard and the mobile app.
Mutations validated here run both on the server (authoritative) and on clients (optimistic updates).
See [RFC 0003](../../docs/rfcs/0003-domain-model.md) and [RFC 0004](../../docs/rfcs/0004-sync-engine.md).

- `lifecycle.ts`: severities, statuses and `canTransition`.
- `access.ts`: roles, the permission table and `can(role, permission)`.
- `id.ts`: prefixed ULIDs (`newId("inc", now, randomBytes)`, `isId`).
- `validate.ts`: the `v.*` argument validators.
- `store.ts`: the `Store` interface and `createMemoryStore`.
- `mutation.ts` / `query.ts`: `defineMutation`, `runMutation`, `defineQuery`, `runQuery`.
- `incidents.ts`: the incident index — `incident.declare`, `incident.setStatus`, `incident.setSeverity`,
  `incidents.active`, `incident.byId` — and the `mutations` / `queries` registries.

```ts
import {
  createMemoryStore,
  mutations,
  newId,
  runMutation,
  type BrigadeTables,
} from "@freecorps/brigade-schema";

const store = createMemoryStore<BrigadeTables>();
const id = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
const result = runMutation(
  mutations,
  "incident.declare",
  { id, title: "Checkout is down", severity: "sev1" },
  store,
  {
    actor: { kind: "user", id: "usr_…", role: "responder" },
    now: Date.now(),
    server: false,
  },
);
```

Code in `src/` stays deterministic and free of React, DOM and Node APIs: time and randomness are always passed in.

License: MIT (so integrations and SDKs can depend on it freely).
