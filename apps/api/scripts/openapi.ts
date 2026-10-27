// Writes the API reference (src/openapi.ts) to docs/api/openapi.json. Run with `vp run openapi` in this package;
// test/openapi.test.ts fails while the committed file differs from what this writes.
import { writeFileSync } from "node:fs";
import { openApiJson } from "../src/openapi.ts";

writeFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), openApiJson());
