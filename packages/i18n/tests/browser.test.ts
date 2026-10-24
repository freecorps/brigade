import { expect, test, vi } from "vite-plus/test";

test("setLocale never reloads the page in a browser", async () => {
  const reload = vi.fn();
  // Paraglide decides "browser or server" when the runtime is imported, so stub first.
  vi.stubGlobal("window", { location: { href: "https://brigade.example/", reload } });
  try {
    const { getLocale, m, setLocale } = await import("../src/index.ts");
    const runtime = await import("../src/paraglide/runtime.js");

    await setLocale("pt-BR");
    expect(reload).not.toHaveBeenCalled();
    expect(getLocale()).toBe("pt-BR");
    expect(m.theme_dark()).toBe("Escuro");

    // Paraglide's own setLocale would have reloaded, which loses the in-memory locale.
    await runtime.setLocale("en");
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
