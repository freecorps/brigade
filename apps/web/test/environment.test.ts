import { m, setLocale } from "@freecorps/brigade-i18n";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { buildEnvironment } from "../src/lib/build-environment";
import { ENVIRONMENT } from "../src/lib/environment";

beforeEach(() => {
  void setLocale("en");
});

describe("which deployment the dashboard says it is", () => {
  test("`vp dev` is local; a build is its Wrangler environment, and production without one", () => {
    expect(buildEnvironment("serve")).toBe("local");
    expect(buildEnvironment("serve", "dev")).toBe("local");
    expect(buildEnvironment("build", "dev")).toBe("dev");
    expect(buildEnvironment("build", "staging")).toBe("staging");
    expect(buildEnvironment("build")).toBe("production");
    expect(buildEnvironment("build", "")).toBe("production");
    // Tests run through the dev server's config.
    expect(ENVIRONMENT).toBe("local");
  });

  test("only local says it runs on your machine", () => {
    expect(m.environment({ env: "local", part: "overview" })).toContain("on your machine");
    for (const env of ["dev", "staging", "production"] as const) {
      expect(m.environment({ env, part: "overview" })).not.toContain("your machine");
      expect(m.environment({ env, part: "stack" })).not.toMatch(/local/i);
    }
    expect(m.environment({ env: "dev", part: "badge" })).toBe("Dev");
    void setLocale("pt-BR");
    for (const env of ["dev", "staging", "production"] as const) {
      expect(m.environment({ env, part: "overview" })).not.toContain("sua máquina");
    }
  });
});
