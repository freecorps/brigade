import { describe, expect, test } from "vite-plus/test";
import indexHtml from "../index.html?raw";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  themePreferences,
  writeThemePreference,
} from "../src/lib/theme.ts";
import { memoryStorage, throwingStorage } from "./storage.ts";

function fakeRoot() {
  const classes = new Set<string>();
  return {
    lang: "en",
    classList: {
      toggle(name: string, force?: boolean) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    isDark: () => classes.has("dark"),
  };
}

describe("theme preference", () => {
  test("resolves system from the OS setting and keeps explicit choices", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    for (const dark of [true, false]) {
      expect(resolveTheme("light", dark)).toBe("light");
      expect(resolveTheme("dark", dark)).toBe("dark");
    }
  });

  test("round-trips through storage", () => {
    const storage = memoryStorage();
    for (const preference of themePreferences) {
      expect(writeThemePreference(storage, preference)).toBe(true);
      expect(storage.data.get(THEME_STORAGE_KEY)).toBe(preference);
      expect(readThemePreference(storage)).toBe(preference);
    }
  });

  test("falls back to system for missing, invalid or unreadable values", () => {
    expect(readThemePreference(memoryStorage())).toBe("system");
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "sepia" }))).toBe("system");
    expect(readThemePreference(throwingStorage)).toBe("system");
    expect(readThemePreference(undefined)).toBe("system");
    expect(writeThemePreference(throwingStorage, "dark")).toBe(false);
    expect(writeThemePreference(undefined, "dark")).toBe(false);
  });

  test("applies the dark class on the root element", () => {
    const root = fakeRoot();
    applyTheme(root, "dark");
    expect(root.isDark()).toBe(true);
    applyTheme(root, "light");
    expect(root.isDark()).toBe(false);
  });
});

describe("index.html pre-paint script", () => {
  const script = /<script id="preferences-script">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? "";

  function run(storage: object, systemDark: boolean) {
    const root = fakeRoot();
    const window = { matchMedia: () => ({ matches: systemDark }) };
    // The script reads globals; hand them in as parameters instead.
    // oxlint-disable-next-line typescript/no-implied-eval -- runs the committed inline script.
    new Function("document", "window", "localStorage", script)(
      { documentElement: root },
      window,
      storage,
    );
    return root;
  }

  test("exists and uses the same storage keys as the app", () => {
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(script).toContain('"brigade-locale"');
  });

  test("resolves the theme exactly like src/lib/theme.ts", () => {
    for (const value of [...themePreferences, "sepia", undefined]) {
      for (const systemDark of [true, false]) {
        const stored: Record<string, string> = value ? { [THEME_STORAGE_KEY]: value } : {};
        const expected = resolveTheme(readThemePreference(memoryStorage(stored)), systemDark);
        const root = run(memoryStorage(stored), systemDark);
        expect(root.isDark(), `${value} with system dark ${systemDark}`).toBe(expected === "dark");
      }
    }
  });

  test("still follows the system theme when storage throws", () => {
    expect(run(throwingStorage, true).isDark()).toBe(true);
    expect(run(throwingStorage, false).isDark()).toBe(false);
  });

  test("sets <html lang> from a valid stored locale only", () => {
    expect(run(memoryStorage({ "brigade-locale": "pt-BR" }), false).lang).toBe("pt-BR");
    expect(run(memoryStorage({ "brigade-locale": "fr" }), false).lang).toBe("en");
  });
});
