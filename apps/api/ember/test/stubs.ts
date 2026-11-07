// Stand-ins for the shard's functions that need the Worker (the notifier, the relay), so the Node tests' engines can
// schedule them: ember/local.ts runs in workerd (test/ember.test.ts).
import { internalActionGeneric } from "@freecorps/ember-server";

/** `local:send`, doing nothing. */
export const local = {
  send: internalActionGeneric({ args: {}, handler: async () => ({ sent: 0 }) }),
};
