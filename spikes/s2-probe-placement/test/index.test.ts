import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vite-plus/test";
import { HINTS, INTERVAL_MS, probeName, TARGETS, TRACE_URL } from "../src/config.ts";
import { measure, parseTrace, rayColo } from "../src/measure.ts";
import type { ProbeDO } from "../src/probe.ts";
import { TEST_TOKEN } from "./token.ts";

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://probe.test${path}`, init);
const admin = (path: string, method = "POST") =>
  call(path, { method, headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

const urlOf = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();

const samplesOf = (stub: DurableObjectStub<ProbeDO>) =>
  runInDurableObject(stub, (instance: ProbeDO) => instance.samples());

/** Answers the trace with a colo and every target with 403, as S3 does for anonymous requests. */
const fakeFetch =
  (colo: string): typeof fetch =>
  async (input) => {
    if (urlOf(input) === TRACE_URL) {
      return new Response(`fl=1\nh=www.cloudflare.com\nip=192.0.2.1\ncolo=${colo}\nloc=DE\n`);
    }
    return new Response(null, { status: 403 });
  };

describe("trace parsing", () => {
  test("reads key=value lines and the cf-ray colo", () => {
    expect(parseTrace("colo=FRA\nloc=DE\n\nbad\n")).toEqual({ colo: "FRA", loc: "DE" });
    expect(rayColo("8f1c2d3e4a5b6c7d-GRU")).toBe("GRU");
    expect(rayColo("nope")).toBeNull();
    expect(rayColo(null)).toBeNull();
  });

  test("measure records a failed request as an error and keeps going", async () => {
    const failing: typeof fetch = async (input) => {
      if (urlOf(input) === TRACE_URL) throw new TypeError("network");
      return new Response(null, { status: 200, headers: { "cf-ray": "x-IAD" } });
    };
    const sample = await measure(failing);
    expect(sample.colo).toBeNull();
    expect(sample.trace).toEqual({ ms: null, error: "TypeError" });
    for (const target of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      expect(sample.targets[target]).toMatchObject({ status: 200 });
    }
  });
});

describe("routes", () => {
  test("refuse requests without the token", async () => {
    expect((await call("/summary")).status).toBe(401);
    for (const path of ["/probes/start", "/probes/stop", "/probes/reset"]) {
      expect((await call(path, { method: "POST" })).status, path).toBe(401);
      const wrong = await call(path, { method: "POST", headers: { Authorization: "Bearer nope" } });
      expect(wrong.status, path).toBe(401);
    }
    expect((await call("/probes/samples?hint=weur")).status).toBe(401);
  });

  test("validate the hint and the method", async () => {
    expect((await admin("/probes/start?hint=mars")).status).toBe(400);
    expect((await admin("/probes/start", "GET")).status).toBe(405);
    expect((await admin("/probes/samples")).status).toBe(405);
    expect((await admin("/probes/samples", "GET")).status).toBe(400);
  });

  test("start one probe, sample on the alarm, stop and reset", async () => {
    const stub = env.PROBE.getByName(probeName("weur"));
    await runInDurableObject(stub, (instance: ProbeDO) => {
      instance.fetcher = fakeFetch("FRA");
    });
    const response = await admin("/probes/start?hint=weur");
    expect(response.status).toBe(200);
    const body = await response.json<{ probes: { hint: string; running: boolean }[] }>();
    expect(body.probes).toEqual([expect.objectContaining({ hint: "weur", running: true })]);

    // `start` sets the first alarm for now; it fires on its own and sets the next one an interval out.
    await vi.waitFor(async () => expect(await samplesOf(stub)).toHaveLength(1));
    const next = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThan(Date.now() + INTERVAL_MS - 5_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const samples = await admin("/probes/samples?hint=weur", "GET");
    const rows = (await samples.json<{ samples: { colo: string; timings: object }[] }>()).samples;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ colo: "FRA", loc: "DE", retry: 0 });
      expect(Object.keys(row.timings).sort()).toEqual(["trace", ...Object.keys(TARGETS)].sort());
    }
    // The egress address in the trace is never stored.
    expect(JSON.stringify(rows)).not.toContain("192.0.2.1");

    const stopped = await (await admin("/probes/stop?hint=weur")).json<{ probes: object[] }>();
    expect(stopped.probes).toEqual([expect.objectContaining({ running: false, nextAlarm: null })]);
    expect(await runDurableObjectAlarm(stub)).toBe(false);

    await admin("/probes/reset?hint=weur");
    expect(await samplesOf(stub)).toEqual([]);
  });

  test("an alarm left over after stop takes no sample", async () => {
    const stub = env.PROBE.getByName(probeName("oc"));
    await runInDurableObject(stub, async (instance: ProbeDO, state) => {
      instance.fetcher = fakeFetch("SYD");
      await state.storage.setAlarm(Date.now() + INTERVAL_MS);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await samplesOf(stub)).toEqual([]);
    expect(await runInDurableObject(stub, (_, state) => state.storage.getAlarm())).toBeNull();
  });
});

describe("GET /summary", () => {
  test("lists every hint", async () => {
    const stub = env.PROBE.getByName(probeName("enam"));
    await runInDurableObject(stub, (instance: ProbeDO) => {
      instance.fetcher = fakeFetch("IAD");
    });
    await stub.start("enam");
    await vi.waitFor(async () => expect(await samplesOf(stub)).toHaveLength(1));

    const response = await admin("/summary", "GET");
    expect(response.status).toBe(200);
    const body = await response.json<{
      probes: { hint: string; samples: number; colos: { colo: string }[] }[];
    }>();
    expect(body.probes.map((probe) => probe.hint)).toEqual([...HINTS]);
    const enam = body.probes.find((probe) => probe.hint === "enam");
    expect(enam).toMatchObject({ samples: 1, running: true, colos: [{ colo: "IAD", samples: 1 }] });
    expect(JSON.stringify(body)).not.toContain("192.0.2.1");
  });

  test("validates hours and the method", async () => {
    expect((await admin("/summary?hours=0", "GET")).status).toBe(400);
    expect((await admin("/summary?hours=abc", "GET")).status).toBe(400);
    // Past the retention window, and far enough to fall outside Date's range.
    expect((await admin("/summary?hours=1e10", "GET")).status).toBe(400);
    expect((await admin("/summary?hours=48", "GET")).status).toBe(200);
    expect((await admin("/summary")).status).toBe(405);
    expect((await call("/nope")).status).toBe(404);
  });
});
