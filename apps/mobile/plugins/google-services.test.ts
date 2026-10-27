import { join, resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { googleServicesFile } from "./google-services.ts";

const home = "/home/someone";
const fallback = join(home, ".config/brigade/google-services.json");

describe("googleServicesFile", () => {
  test("GOOGLE_SERVICES_FILE wins, with ~ and relative paths resolved", () => {
    const none = () => false;
    expect(googleServicesFile({ GOOGLE_SERVICES_FILE: "/secrets/gs.json" }, none, home)).toBe(
      "/secrets/gs.json",
    );
    expect(googleServicesFile({ GOOGLE_SERVICES_FILE: "~/gs.json" }, none, home)).toBe(
      join(home, "gs.json"),
    );
    expect(googleServicesFile({ GOOGLE_SERVICES_FILE: "gs.json" }, none, home)).toBe(
      resolve("gs.json"),
    );
  });

  test("otherwise the file under ~/.config/brigade, only when it exists", () => {
    expect(googleServicesFile({}, (path) => path === fallback, home)).toBe(fallback);
    expect(googleServicesFile({}, () => false, home)).toBeUndefined();
    expect(googleServicesFile({ GOOGLE_SERVICES_FILE: " " }, () => false, home)).toBeUndefined();
  });
});
