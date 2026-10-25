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

## Check types (v1)

- HTTP(S): status, latency, keyword/regex in body, headers, TLS expiry.
- TCP: connect via `connect()` (Sockets API). Not available for Cloudflare IP ranges.
- Heartbeat (push-based): the monitored system calls Brigade; missing beats raise an alert. Covers cron jobs and internal hosts.
- No ICMP. Internal networks only via heartbeat or Cloudflare Tunnel.

## Quorum and flapping

A monitor raises an alert only when **K of N regions** fail for **M consecutive checks** (defaults: 2 of 3, 2 checks).
Recovery uses the same rule. Results feed `AlertGroupDO` as normal `AlertEvent`s, so monitors and external
alerts share routing and dedupe.

## Watching the watcher

- External dead-man switch: the `api` Worker pings an external heartbeat service (e.g. healthchecks.io) every minute;
  if Brigade itself stops, that service pages through an independent channel.
- Internal self-check: a DO alarm verifies every `ProbeDO` reported recently and alerts on stalled probes.

## Notes

- Probes originate from Cloudflare IPs. Targets behind strict firewalls must allow them (or use heartbeats).
- Targets hosted on the same Cloudflare account are reached through Cloudflare's network; this checks the public path
  through Cloudflare, not the origin directly. Add a separate check against the origin when needed.
