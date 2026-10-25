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
  region has reported nothing for 15 minutes, which re-arms a probe whose alarm was lost.

## Check types (v1)

- HTTP(S): status, latency, keyword/regex in body, headers, TLS expiry. Built: method `GET` or `HEAD`, an expected
  status (default any 2xx or 3xx), a keyword (plain text, `GET` only), interval 30 s to 24 h, timeout 1 to 30 s.
  Regex, headers and TLS expiry are not built yet.
- **Targets (SSRF):** only `http:` and `https:`, no credentials in the URL, and no host that is private, loopback,
  link-local, shared, reserved or multicast (IPv4 and IPv6 literals, any IPv4 spelling the URL parser normalises),
  nor a local-only name (`localhost`, single-label, `.local`, `.internal`, `.lan`, `.home.arpa`, …). Checked when a
  monitor is saved and again by the probe before every request (`targetProblem`). Redirects are never followed (a
  3xx is the answer), at most 64 KiB of a body is read, and every request has its timeout. A public name that
  resolves to a private address is not caught (Workers cannot resolve names); deployed Workers cannot reach private
  networks.
- TCP: connect via `connect()` (Sockets API). Not available for Cloudflare IP ranges.
- Heartbeat (push-based): the monitored system calls Brigade; missing beats raise an alert. Covers cron jobs and internal hosts.
  Built: `POST /heartbeat/<workspace id>.<monitor id>.<secret>` (also under the dashboard's `/api`). The secret is
  32 random bytes made by the client, which shows the URL once and sends only its SHA-256; the shard stores the hash
  in a server-only table and compares in constant time. Every refusal is the same 404. A ping turns the monitor up;
  no ping within interval + grace (0 s to 24 h) is a failure, found by the workspace shard's alarm (at least once a
  minute), and with one source that is the quorum.
- No ICMP. Internal networks only via heartbeat or Cloudflare Tunnel.

## Quorum and flapping

A monitor raises an alert only when **K of N regions** fail for **M consecutive checks** (defaults: 2 of 3, 2 checks).
Recovery uses the same rule. Results feed `AlertGroupDO` as normal `AlertEvent`s, so monitors and external
alerts share routing and dedupe.

Built (first slice): K is a majority of the monitor's regions (1 of 1, 2 of 2, 2 of 3, 3 of 4, …; not configurable
yet) and M is 2 (`CONSECUTIVE_CHECKS`): a region's verdict flips after two alike results (a new monitor is up on its
first success). The probe reports a region's verdict to the workspace shard when it changes, and otherwise every
5 minutes so the latency and colo stay fresh without a shard version per check. Until `AlertGroupDO` and alert routes
exist, the workspace shard is the alert's home: the server-only mutation `monitor.report`, run as the system actor
`sys_monitors` (RFC 0004 "Server-side writes"), records the result, and when the quorum turns down it fires one alert
per monitor (`alerts` table, fingerprint `monitor:<id>`; no second one while it fires) and opens an incident through
`incident.declare` (SEV2, "<name> is down") in the same transaction, so there is never an alert without its
incident. When the quorum turns up again the alert resolves; the incident is left for people, since incidents have no
timeline yet. Pausing or deleting a monitor resolves its alert too. Every step is an event in the outbox
(`monitor.*`, `alert.fired`, `alert.resolved`, `incident.declared`).

## Watching the watcher

- External dead-man switch: the `api` Worker pings an external heartbeat service (e.g. healthchecks.io) every minute;
  if Brigade itself stops, that service pages through an independent channel.
- Internal self-check: a DO alarm verifies every `ProbeDO` reported recently and alerts on stalled probes.
  Built so far: the workspace shard's alarm logs a stalled region and pushes its config again; it does not alert yet.

## Notes

- Probes originate from Cloudflare IPs. Targets behind strict firewalls must allow them (or use heartbeats).
- Targets hosted on the same Cloudflare account are reached through Cloudflare's network; this checks the public path
  through Cloudflare, not the origin directly. Add a separate check against the origin when needed.
