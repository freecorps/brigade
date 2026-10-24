import { describe, expect, test } from "vite-plus/test";
import { formatBytes } from "../src/lib/format.ts";

describe("formatBytes", () => {
  test("uses decimal units with one decimal above bytes", () => {
    expect(formatBytes(0, "en")).toBe("0 byte");
    expect(formatBytes(8192, "en")).toBe("8.2 kB");
    expect(formatBytes(10_737_418_240, "pt-BR")).toBe("10,7 GB");
  });

  test("picks the unit after rounding, so no value prints as 1,000 of the smaller unit", () => {
    expect(formatBytes(999, "en")).toBe("999 byte");
    expect(formatBytes(999.6, "en")).toBe("1 kB");
    expect(formatBytes(999_949, "en")).toBe("999.9 kB");
    expect(formatBytes(999_950, "en")).toBe("1 MB");
    expect(formatBytes(999_999_999, "pt-BR")).toBe("1 GB");
  });
});
