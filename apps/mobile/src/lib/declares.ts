// The declare sheet sends; the incident list follows the outcome (`channel.ts`).
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { channel } from "./channel";

export type Declared = { incidentId: string; title: string; outcome: Promise<MutationOutcome> };

const declares = channel<Declared>();

export const announceDeclare = declares.send;
export const onDeclare = declares.listen;
