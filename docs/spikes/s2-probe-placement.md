# Spike S2 — Probe placement

- Status: Running. Deployed and sampling since 2026-10-25 14:51 UTC; the 48-hour result is pending (see the end)
- Roadmap: Phase 0, S2
- Settles (once the 48 hours are read): RFC 0007 "Placement" (one `ProbeDO` per workspace and region, created with
  a `locationHint`, reporting the colo it really ran from)

## Question

RFC 0007 plans one `ProbeDO` per workspace and region, created with a Durable Object `locationHint`, running its
checks on `alarm()` and reporting where they really ran. Hints are best-effort. The pass criterion: the colo
observed per `locationHint` over 48 hours. In detail:

1. For each hint, which colo does the object land in? Does it stay there, and do its alarms keep firing from the
   same place?
2. Where do its outbound `fetch` calls egress, and what latency does that give to a few fixed public targets?
3. Is that good enough for RFC 0007's design, or what has to change?

## What was built

`spikes/s2-probe-placement` (`@freecorps/brigade-spike-s2`, private, AGPL-3.0-only): one Worker, deployed as
`brigade-probe-dev`, with one SQLite-backed `ProbeDO`. It is spike code, outside `apps/` and `packages/`, and is
not meant to become product code; it sits in the workspace (`spikes/*`) only so CI checks and tests it.

- **One object per hint**, named `s2:<hint>` and created with `getByName(name, { locationHint: hint })`. All
  eleven hints the installed types accept are probed: RFC 0007's nine plus `apac-ne` and `apac-se`, which
  Cloudflare added later as narrower parts of `apac`.
- **One sample a minute** on `alarm()`. The handler sets the next alarm first (now + 60 s), so a failed sample
  cannot end the chain, then:
  - fetches `https://www.cloudflare.com/cdn-cgi/trace`, whose `colo=` line names the Cloudflare colo the
    subrequest entered from (the trick where.durableobjects.live uses; Cloudflare offers no API that tells an
    object where it runs);
  - times `HEAD` requests to three AWS S3 regional endpoints (us-east-1, eu-central-1, ap-southeast-1), one
    after another, up to the response headers, with `cache: "no-store"`, no redirects and a 5 s timeout;
  - writes one row: start time, the time the alarm was set for, its retry count, a random id per object
    instance, colo, the trace's `loc`, and the timings. The egress address in the trace is not stored. Rows
    older than 8 days are pruned.
- **Routes.** `GET /summary[?hours=N]`: per hint, the colo histogram with first and last seen, the
  number of colo changes and the runs between them, instances, the gaps between samples, alarm lateness, retries
  and latency percentiles (nearest rank). Also `POST /probes/{start,stop,reset}` and `GET /probes/samples` (raw
  rows). Every route needs `Authorization: Bearer <PROBE_ADMIN_TOKEN>`, a Wrangler secret compared by SHA-256
  digest with `crypto.subtle.timingSafeEqual`; `/summary` too, since each call wakes all eleven objects and
  reads days of rows.
- **Report.** `PROBE_ADMIN_TOKEN=<token> vpx scripts/report.ts <worker url> [--hours 48]` prints the summary as three tables
  (placement, alarms, latency), plus the colo runs of any probe that moved.
- **Tests** (`@cloudflare/vitest-plugin`, as in apps/api): the summary logic (percentiles, colo runs and moves,
  instances, failures, retries), trace parsing, every route refusing a missing or wrong token, an alarm
  storing a sample from a stubbed fetch and scheduling the next one, stop, reset, and `/summary` listing every
  hint without the egress address.

Cost: 11 objects, 4 subrequests each a minute, about 63,000 subrequests and 16,000 alarm invocations a day.

## How it was run

```bash
vp run --filter @freecorps/brigade-spike-s2 build
cd spikes/s2-probe-placement
bunx wrangler deploy --secrets-file <file outside the repo with PROBE_ADMIN_TOKEN=<random>>
curl -X POST -H "Authorization: Bearer <token>" https://brigade-probe-dev.<subdomain>.workers.dev/probes/start
vpx scripts/report.ts https://brigade-probe-dev.<subdomain>.workers.dev
```

Deployed 2026-10-25 from a developer machine with wrangler 4.152.0 (compatibility date 2026-10-19). Every object was
first reached by that `start` call, so its hint, not the caller's location, decided where it was created.

## First results

Read at 2026-10-25 14:42 UTC, one to two samples per hint. Timings are milliseconds to response headers, for the
first samples only.

| Hint      | Colo | Trace | us-east-1 | eu-central-1 | ap-southeast-1 |
| --------- | ---- | ----- | --------- | ------------ | -------------- |
| `wnam`    | SEA  | 42    | 395       | 1397         | 741            |
| `enam`    | MIA  | 31    | 116       | 450          | 930            |
| `sam`     | MIA  | 30    | 115       | 456          | 982            |
| `weur`    | CDG  | 13    | 328       | 46           | 619            |
| `eeur`    | FRA  | 15    | 380       | 14           | 670            |
| `apac`    | NRT  | 14    | 728       | 943          | 313            |
| `apac-ne` | KIX  | 9     | 680       | 1025         | 1654           |
| `apac-se` | SIN  | 4     | 1038      | 735          | 20             |
| `oc`      | SYD  | 13    | 870       | 1361         | 995            |
| `afr`     | LHR  | 16    | 339       | 60           | 656            |
| `me`      | WAW  | 23    | 451       | 91           | 724            |

What these first samples already show:

- **Eight hints landed in their region**: `wnam` (Seattle), `enam` (Miami), `weur` (Paris), `eeur` (Frankfurt),
  `apac` (Tokyo), `apac-ne` (Osaka), `apac-se` (Singapore), `oc` (Sydney).
- **Three did not**, as Cloudflare's data location page says (Durable Objects do not spawn in South America,
  Africa or the Middle East yet; they go to a nearby supported region): `sam` landed in Miami, `afr` in London,
  `me` in Warsaw. A "São Paulo" probe would really check from Miami.
- **Egress follows the colo.** Each probe is fastest to the AWS region nearest its colo (Frankfurt 14 ms from
  FRA, Singapore 20 ms from SIN), so the outbound calls leave from where the object runs, not from somewhere
  central.
- **The trace's `loc` is no use**: it said `US` for every probe, Frankfurt and Sydney included. It geolocates the
  internal address a Worker subrequest arrives from. Only `colo` (or the `cf-ray` suffix) says where a probe is.
- **The timings are cold connections.** Each one includes DNS, TCP and TLS setup, roughly three to four round
  trips (Miami to us-east-1: 116 ms), and the very first sample of each probe is slower still (`apac-ne` to
  Singapore: 1654 ms). Product checks will report the same cold-connection time unless they separate connect
  from response time, which a Worker `fetch` does not expose.
- **The alarms ran on time**: within 0 to 150 ms of the time they were set for, 60 s apart, no retries.
- **In the first samples, each one ran in a new instance**: the runtime seems to evict the idle object between
  alarms a minute apart and construct it again in the same colo. If that holds over 48 hours, a new instance is
  not a migration signal (only a colo change is), and a probe pays the object's cold start on every run.

## What remains to observe (pending)

The 48-hour window ends 2026-10-27 14:51 UTC (the samples were reset when the reviewed version was deployed). Then, from `PROBE_ADMIN_TOKEN=<token> vpx scripts/report.ts <url> --hours 48`:

- [ ] Colo histogram per hint: still one colo each, or did any probe move (`moves`, and the colo runs)?
- [ ] Alarm cadence: gaps between samples (p95, max), lateness, retries, and any hole longer than a few minutes.
- [ ] Latency percentiles per hint and target over 48 hours, and how many requests failed.
- [ ] Instances per hint over 48 hours: is every sample a new instance, as the first ones suggest?
- [ ] Answer question 3 and update RFC 0007 "Placement" in the same PR as this result.

Do not redeploy `brigade-probe-dev` before the window ends: a deploy restarts every object, which inflates
`instances` and could move a probe.

The probes keep running after the window. Once the result is recorded, stop them with `POST /probes/stop` (keeps
the samples), and in the PR that records the result delete the Worker (`wrangler delete`, which deletes the
samples too, so only after the result is written down) and remove `spikes/s2-probe-placement`, following RFC
0002's rule for spike code.

## Result (48 hours)

Pending.

## Decision

Pending the 48-hour result. Leaning, from the first samples: keep `ProbeDO` with `locationHint` for the regions
where Durable Objects spawn, and do not offer `sam`, `afr` or `me` as check locations (or label them with the colo
they really run from) until Cloudflare places objects there; show the observed colo, never the hint, in the UI.

## Resources created

On the Freecorps Cloudflare account:

- Worker `brigade-probe-dev`, on its workers.dev URL (no routes, no custom domain, no preview URLs)
- Durable Object namespace for `ProbeDO` (SQLite), class of `brigade-probe-dev`, with eleven objects `s2:<hint>`
- Secret `PROBE_ADMIN_TOKEN` on `brigade-probe-dev`
