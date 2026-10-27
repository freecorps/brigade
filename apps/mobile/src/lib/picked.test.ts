import { describe, expect, test } from "vite-plus/test";
import { caughtUp } from "./picked.ts";

describe("caughtUp", () => {
  test("only once the synced row has every switch as picked", () => {
    const picked = { missedPages: false, followUpReminders: false };
    // The first switch synced, the second not yet: still picked, so a third switch starts from both.
    expect(caughtUp(picked, { missedPages: false, followUpReminders: true })).toBe(false);
    expect(caughtUp(picked, { missedPages: false, followUpReminders: false })).toBe(true);
  });
});
