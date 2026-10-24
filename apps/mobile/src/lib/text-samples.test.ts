import { UNICODE_PROPERTY_ESCAPES } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { checkTitle, TITLE_SAMPLES } from "./text-samples.ts";

describe("title samples", () => {
  test("Node runs the full text rules", () => {
    expect(UNICODE_PROPERTY_ESCAPES).toBe(true);
  });

  test("each sample gets the result the server's rules give", () => {
    for (const sample of TITLE_SAMPLES) {
      expect(checkTitle(sample.value).accepted, sample.label).toBe(sample.expected === "accepted");
    }
  });
});
