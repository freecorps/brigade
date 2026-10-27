// What makes the package publishable under MIT (RFC 0009; AGENTS.md "packages/* stay MIT and framework-light"): no
// import of app or integration code (AGPL), nothing at runtime but the schema package (bundled into dist by
// vite.config.ts), and the fields npm needs. scripts/check-dist.mjs checks the built files after `vp run build`.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json")) as Record<string, unknown>;

/** Every module specifier `text` imports or re-exports. */
function specifiers(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
    ),
  ].map((match) => (match[1] ?? match[2])!);
}

describe("package", () => {
  test("MIT, ESM, side-effect free, with types, publishing dist only", () => {
    expect(pkg).toMatchObject({
      name: "@freecorps/brigade-sdk",
      version: "0.1.0",
      license: "MIT",
      type: "module",
      sideEffects: false,
      files: ["dist", "CHANGELOG.md"],
      publishConfig: {
        access: "public",
        exports: { ".": "./dist/index.mjs", "./package.json": "./package.json" },
      },
    });
    expect(read("LICENSE")).toMatch(/^MIT License/);
    expect(read("CHANGELOG.md")).toContain("## 0.1.0");
  });

  test("no dependency at runtime: the schema package is bundled", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    const dev = Object.keys(pkg.devDependencies as Record<string, string>);
    for (const name of dev.filter((one) => one.startsWith("@freecorps/"))) {
      // Only MIT workspace packages: never an app or integration.
      expect(name, name).toBe("@freecorps/brigade-schema");
      const other = JSON.parse(read(`../schema/package.json`)) as { license: string };
      expect(other.license).toBe("MIT");
    }
  });

  test("src imports only itself and the schema package", () => {
    for (const file of readdirSync(new URL("src/", root)).filter((one) => one.endsWith(".ts"))) {
      for (const specifier of specifiers(read(`src/${file}`))) {
        expect(
          specifier.startsWith("./") || specifier === "@freecorps/brigade-schema",
          `${file}: ${specifier}`,
        ).toBe(true);
      }
    }
  });

  test("the schema package imports nothing outside itself either", () => {
    for (const file of readdirSync(new URL("../schema/src/", root)).filter((one) =>
      one.endsWith(".ts"),
    )) {
      for (const specifier of specifiers(read(`../schema/src/${file}`))) {
        expect(specifier.startsWith("./"), `schema/${file}: ${specifier}`).toBe(true);
      }
    }
  });
});
