import { themes } from "@freecorps/brigade-ui";
import { describe, expect, test } from "vite-plus/test";
import { themeFor, themeName } from "./theme.ts";

describe("theme", () => {
  test("dark only when the system says dark", () => {
    expect(themeName("dark")).toBe("dark");
    expect(themeName("light")).toBe("light");
    expect(themeName("unspecified")).toBe("light");
    expect(themeName(null)).toBe("light");
    expect(themeName(undefined)).toBe("light");
  });

  test("returns packages/ui's theme objects", () => {
    expect(themeFor("dark")).toBe(themes.dark);
    expect(themeFor(null)).toBe(themes.light);
  });
});
