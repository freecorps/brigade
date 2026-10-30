// The declare sheet closes as soon as it sends (the change shows at once and settles later, RFC 0004); the incident
// list, which stays mounted under it, follows the outcome and says so if the shard refuses it.
import type { MutationOutcome } from "@freecorps/brigade-sync";

export type Declared = { incidentId: string; title: string; outcome: Promise<MutationOutcome> };

type Listener = (declared: Declared) => void;

const listeners = new Set<Listener>();
/** Declares sent while no list listened (none mounted yet), handed to the next one that does. */
let unheard: Declared[] = [];

export function announceDeclare(declared: Declared): void {
  if (listeners.size === 0) {
    unheard.push(declared);
    return;
  }
  for (const listener of listeners) listener(declared);
}

export function onDeclare(listener: Listener): () => void {
  listeners.add(listener);
  const waiting = unheard;
  unheard = [];
  for (const declared of waiting) listener(declared);
  return () => {
    listeners.delete(listener);
  };
}
