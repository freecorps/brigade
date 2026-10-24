// Regenerates the shipped CSS from src/tokens.ts. Run with `vp run generate` in this package.
import { writeFileSync } from "node:fs";
import { themeCss, tokensCss } from "../src/css.ts";

writeFileSync(new URL("../src/tokens.css", import.meta.url), tokensCss());
writeFileSync(new URL("../src/theme.css", import.meta.url), themeCss());
