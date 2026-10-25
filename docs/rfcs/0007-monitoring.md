# RFC 0007 — Multi-region monitoring

- Status: Draft

## Placement

- Regular Workers run near the caller; Cron Triggers run wherever Cloudflare schedules them. Neither gives region control.
- **`ProbeDO` with `locationHint`** (`wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`) — one per
  workspace and region. Hints are best-effort; the DO reports its actual colo (`request.cf.colo` on its outbound
  calls / trace) so the UI shows where checks really ran. Validate in spike S2 (running; first samples in
  [docs/spikes/s2-probe-placement.md](../spikes/s2-probe-placement.md): `sam`, `afr` and `me` land in Miami,
  London and Warsaw, as Cloudflare documents that objects do not spawn in those regions yet).
- Each `ProbeDO` uses `alarm()` to run its monitors on schedule (min interval: 30s).
- **Built (first slice):** `ProbeDO` is named `<workspace>:<region>` and created with that hint. Monitors offer only
  the regions where objects spawn in-region in S2's first samples: `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`
  (`PROBE_REGIONS` in `packages/schema`); `sam`, `afr` and `me` are not offered until Cloudflare places objects
  there. Every result carries the colo the probe really ran from (`/cdn-cgi/trace`, fetched once per alarm run), and
  the dashboard shows it next to the region. The 48-hour S2 result (due 2026-10-27) may still change this list.
- **The alarm chain never ends on a failure:** every alarm sets the next one before doing anything else (as S2's
  probe did); the workspace shard re-pushes each region's checks every 10 minutes, and at once when an active
  region has reported nothing for 15 minutes, which re-arms a probe whose alarm was lost. The shard's own alarm sets
  a fallback a minute out before its work and moves it to the next deadline after, and an accepted heartbeat ping
  re-arms it if it is missing.
- **Cost of slow targets:** a probe runs at most 6 checks at once and waits up to the timeout (at most 30 s) for each,
  so a region whose targets all time out keeps its object busy, and billed for duration, for about
  `ceil(checks / 6) × timeout` per run instead of a few hundred milliseconds.

## Check types (v1)

- HTTP(S): status, latency, keyword/regex in body, headers, TLS expiry. Built: method `GET` or `HEAD`, an expected
  status (default any 2xx or 3xx), a keyword (plain text, `GET` only), interval 30 s to 24 h, timeout 1 to 30 s.
  Regex, headers and TLS expiry are not built yet.
- **Targets (SSRF):** only `http:` and `https:`, no credentials in the URL, and no host that is private, loopback,
  link-local, shared, reserved or multicast (IPv4 and IPv6 literals, any IPv4 spelling the URL parser normalises),
  nor a local-only name (`localhost`, single-label, `.local`, `.internal`, `.lan`, `.home.arpa`, …). Checked when a
  monitor is saved and again by the probe before every request (`targetProblem`). Also refused: `192.88.99.0/24`
  (6to4 relay), `2001:2::/48` (benchmarking) and `2001:10::/28` (ORCHID).
- **Ports:** only the default ports, 8080 and 8443, and the other ports Cloudflare proxies HTTP(S) on (2052, 2053,
  2082, 2083, 2086, 2087, 2095, 2096, 8880): `MONITOR_PORTS`. Not "anything above 1024": Redis, Elasticsearch and
  friends listen there, and a check's error (`network` against `timeout`) would tell whether something answers, which
  makes a monitor a port scanner. A health endpoint on another port goes behind a proxy, or uses a heartbeat.
- **Secrets in URLs:** everyone in the workspace can read monitors, viewers included, so a token in a query string
  is visible to all of them. The form says so under the URL field; values are not redacted per role, since the
  query result is the same rows for every member. Redirects are never followed (a
  3xx is the answer), at most 64 KiB of a body is read, and every request has its timeout. A public name that
  resolves to a private address is not caught (Workers cannot resolve names); deployed Workers cannot reach private
  networks.
- TCP: connect via `connect()` (Sockets API). Not available for Cloudflare IP ranges.
- Heartbeat (push-based): the monitored system calls Brigade; missing beats raise an alert. Covers cron jobs and internal hosts.
  Built: `POST /heartbeat/<workspace id>.<monitor id>.<secret>` (also under the dashboard's `/api`). The secret is
  32 random bytes made by the client, which shows the URL once and sends only its SHA-256; the shard stores the hash
  in a server-only table and compares in constant time. The Worker first checks that the workspace exists in D1
  (cached per isolate for 10 minutes), so a made-up workspace creates no Durable Object (Q16); if the D1 read fails, the ping goes to the shard
  anyway (fail open: a D1 outage must not page anyone for a missed beat). Every refusal is the same 404. A ping turns the monitor up;
  no ping within interval + grace (0 s to 24 h) is a failure, found by the workspace shard's alarm (at least once a
  minute), and with one source that is the quorum.
- No ICMP. Internal networks only via heartbeat or Cloudflare Tunnel.

## Quorum and flapping

A monitor raises an alert only when **K of N regions** fail for **M consecutive checks** (defaults: 2 of 3, 2 checks).
Recovery uses the same rule. Results feed `AlertGroupDO` as normal `AlertEvent`s, so monitors and external
alerts share routing and dedupe.

Built (first slice): K is a majority and M is 2 (`CONSECUTIVE_CHECKS`): a region's verdict flips after two alike
results (a new monitor is up on its first success). The probe reports a region's verdict to the workspace shard when
it changes, and otherwise every 5 minutes, with the time of its latest check, so the latency, colo and check time stay
fresh without a shard version per check. Those refreshes change the synced row but are no domain events: the
mutation is declared `silent` and writes nothing to the outbox; `monitor.checked` is emitted only when a region's
verdict or failure reason changes.

- **Freshness:** a region's result counts for `max(3 × interval, 2 × 5 min)` (`staleAfterMs`; two refresh periods
  at least, since an unchanged verdict is re-sent only every 5 minutes). The status is a majority of the fresh
  results (1 of 1, 2 of 2, 2 of 3, …), and at least half of the monitor's regions, rounded up, must be fresh
  (`freshFloor`): with fewer, a majority of the fresh ones could be one region speaking for three. Below that the
  monitor is `unknown`, shown as "No data", never as up; a new monitor stays `pending` until the window passes. The
  shard's alarm re-evaluates every minute and runs `monitor.evaluate` when results went stale. A heartbeat's result
  never goes stale: the shard reports the missed ping itself.
- **"No data" does not page** (open question Q17): it opens no incident, since the failure is Brigade's probes, but
  it never resolves a firing alert either (no data is no recovery), the dashboard shows it, and
  `monitor.status_changed` goes to the outbox for notifiers. A down monitor whose probes die stays down-alerted.
  The other side of it: a monitor that goes down *after* most of its probes died shows `unknown` and does not
  page, even when every surviving region sees it down (an up monitor in three regions whose `enam` and `weur`
  probes went silent, then `wnam` reports down: one fresh result is below the floor of two, so "No data", no
  alert, no incident). An outage that only the surviving probes see is therefore missed until enough regions report
  again; whether to page on it, or to page Brigade's operators on `unknown`, is Q17.
- **Restarts:** creating a monitor, changing its target and resuming it set `restartedAt`; results from before it are
  refused. A status change does not move it, so a report computed before another region flipped the status and
  delivered after it still counts (no false recovery, no second incident). Until `AlertGroupDO` and alert routes
  exist, the workspace shard is the alert's home: the server-only mutation `monitor.report`, run as the system actor
  `sys_monitors` (RFC 0004 "Server-side writes"), records the result, and when the quorum turns down it fires one alert
  per monitor (`alerts` table, fingerprint `monitor:<id>`; no second one while it fires) and opens an incident through
  `incident.declare` (SEV2, "<name> is down") in the same transaction, so there is never an alert without its
  incident (its `incident.declared` event comes before `alert.fired`). When the quorum turns up again the alert resolves; the incident is left for people, since incidents have no
  timeline yet. Pausing or deleting a monitor resolves its alert too. Every step is an event in the outbox
  (`monitor.*`, `alert.fired`, `alert.resolved`, `incident.declared`).

## Watching the watcher

- External dead-man switch: the `api` Worker pings an external heartbeat service (e.g. healthchecks.io) every minute;
  if Brigade itself stops, that service pages through an independent channel.
- Internal self-check: a DO alarm verifies every `ProbeDO` reported recently and alerts on stalled probes.
  Built so far: the workspace shard's alarm logs a stalled region and pushes its config again, and a monitor whose
  regions all go quiet turns "No data"; it does not page yet (Q17).

## Notes

- Probes originate from Cloudflare IPs. Targets behind strict firewalls must allow them (or use heartbeats).
- Targets hosted on the same Cloudflare account are reached through Cloudflare's network; this checks the public path
  through Cloudflare, not the origin directly. Add a separate check against the origin when needed.
