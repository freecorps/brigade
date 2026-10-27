// What makes the package publishable under MIT (RFC 0009; AGENTS.md "packages/* stay MIT and framework-light"): no
// import of app or integration code (AGPL), nothing at runtime but the schema package (bundled into dist by
// vite.config.ts), and the fields npm needs. scripts/check-dist.mjs checks the built files after `vp run build`.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json")) as Record<string, unknown>;

// A statement that starts with `import` or `export` and names no string before `from "x"`; `import "x"` at the start
// of a line; `import("x")` anywhere. Prose in comments (a quoted "from", say) is none of them.
const IMPORT =
  /^\s*(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

/**
 * Every module specifier `text` imports or re-exports: `import … from "x"`, `export … from "x"` (types and `*` too),
 * `import "x"` for its side effects, and `import("x")`.
 */
function specifiers(text: string): string[] {
  return [...text.matchAll(IMPORT)].map((match) => (match[1] ?? match[2] ?? match[3])!);
}

test("specifiers finds every form of import", () => {
  const text = [
    'import { a } from "./a.ts";',
    'import type { B } from "b";',
    'import "c";',
    "import 'd';",
    'export * from "e";',
    'export { f } from "f";',
    'export type { G } from "g";',
    'const h = await import("h");',
    'import {\n  i,\n  j,\n} from "ij";',
    '// a "from" in prose is not an import, nor is "imported" text',
  ].join("\n");
  expect(specifiers(text)).toEqual(["./a.ts", "b", "c", "d", "e", "f", "g", "h", "ij"]);
});

describe("package", () => {
  test("MIT, ESM, side-effect free, with types, publishing dist only", () => {
    expect(pkg).toMatchObject({
      name: "@freecorps/brigade-sdk",
      version: "0.2.0",
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
    expect(read("CHANGELOG.md")).toContain("## 0.2.0");
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
