// Spike S4: does this engine run packages/schema's full text rules (Unicode property escapes, RFC 0004
// "Shared core")? Two incident titles go through the same validator the server uses for incident.declare.
import { INCIDENT_TITLE_MAX, v } from "@freecorps/brigade-schema";

export interface TitleSample {
  /** How the sample is shown: a hidden code point is spelled out, since it cannot be seen. */
  readonly label: string;
  readonly value: string;
  /** What the server's full rules do with it. */
  readonly expected: "accepted" | "rejected";
}

export const TITLE_SAMPLES: readonly TitleSample[] = [
  { label: "Checkout down 🔥", value: "Checkout down 🔥", expected: "accepted" },
  { label: "Checkout<U+200B>down", value: "Checkout​down", expected: "rejected" },
];

const title = v.string({ min: 1, max: INCIDENT_TITLE_MAX });

export type TitleCheck = { accepted: true } | { accepted: false; message: string };

export function checkTitle(value: string): TitleCheck {
  const result = title(value, "title");
  return result.ok
    ? { accepted: true }
    : { accepted: false, message: result.issues.map((issue) => issue.message).join("; ") };
}
