// The update sheet posts or edits a written update; the incident screen follows the outcome (`channel.ts`).
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { channel } from "./channel";

export type UpdateSent =
  | { kind: "post"; incidentId: string; body: string; outcome: Promise<MutationOutcome> }
  | { kind: "edit"; incidentId: string; entryId: string; outcome: Promise<MutationOutcome> };

const updates = channel<UpdateSent>();

export const announceUpdate = updates.send;
export const onUpdate = updates.listen;
