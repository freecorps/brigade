import { describe, expect, test } from "vite-plus/test";
import { INTL_FEATURES, probeIntl } from "./probe.ts";

// Intl's members are not enumerable, so build on it instead of spreading it.
const intlWith = (overrides: Record<string, unknown>) =>
  Object.assign(Object.create(Intl) as typeof Intl, overrides);

describe("probeIntl", () => {
  test("Node's full ICU passes every check", () => {
    const report = probeIntl();
    for (const feature of INTL_FEATURES) {
      expect(report[feature], feature).toMatchObject({ works: true });
    }
  });

  test("reports a missing constructor as not working, without throwing", () => {
    const report = probeIntl(intlWith({ PluralRules: undefined }));
    expect(report.pluralRules.works).toBe(false);
    expect(report.numberFormat.works).toBe(true);
  });

  test("reports an engine that ignores dateStyle", () => {
    class IgnoresStyle extends Intl.DateTimeFormat {
      constructor(locale?: string, options?: Intl.DateTimeFormatOptions) {
        const { dateStyle: _date, timeStyle: _time, ...rest } = options ?? {};
        super(locale, rest);
      }
    }
    const report = probeIntl(intlWith({ DateTimeFormat: IgnoresStyle }));
    expect(report.dateTimeStyle).toMatchObject({ works: false, detail: "3/5/2026" });
  });
});
