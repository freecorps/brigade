import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { cameraUsage, infoPlistStrings } from "./camera-usage.ts";

test("InfoPlist.strings carries the usage text, escaped", () => {
  expect(infoPlistStrings('Scan the "Use the app" code')).toContain(
    '"NSCameraUsageDescription" = "Scan the \\"Use the app\\" code";',
  );
});

test("the camera usage text comes from the catalog, in en and pt-BR", () => {
  const usage = cameraUsage(join(import.meta.dirname, "../../../packages/i18n/messages"));
  expect(usage.en).toMatch(/camera/i);
  expect(usage["pt-BR"]).toMatch(/câmera/i);
});

test("a catalog without it fails the build instead of shipping the system's default text", () => {
  expect(() => cameraUsage("/catalog", () => JSON.stringify({ other: "x" }))).toThrow(
    "mobile_camera_usage",
  );
});
