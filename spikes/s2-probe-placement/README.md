# Spike S2 — probe placement

Throwaway code for spike S2 (RFC 0007, "Placement"); not product code. One Worker, `brigade-probe-dev`, with one
SQLite-backed `ProbeDO` per Durable Object `locationHint`. Each probe samples on `alarm()` every 60 s: the colo its
outbound calls enter Cloudflare from (`/cdn-cgi/trace`) and the time to response headers from three AWS S3
regional endpoints. Question, method and results: [docs/spikes/s2-probe-placement.md](../../docs/spikes/s2-probe-placement.md).

| Route                                  | Auth  | Does                                                       |
| -------------------------------------- | ----- | ---------------------------------------------------------- |
| `GET /summary[?hours=N]`               | token | Per-hint summary as JSON (no addresses, no instance ids)   |
| `POST /probes/start[?hint=H]`          | token | Starts every probe (or one); the first sample runs at once |
| `POST /probes/stop[?hint=H]`           | token | Stops sampling; keeps the samples                          |
| `POST /probes/reset[?hint=H]`          | token | Stops and deletes the samples                              |
| `GET /probes/samples?hint=H[&hours=N]` | token | Raw samples of one probe                                   |

The token is the `PROBE_ADMIN_TOKEN` secret, sent as `Authorization: Bearer <token>`. `hours` is at most 192
(the retention window).

```bash
vp run --filter @freecorps/brigade-spike-s2 test
vp run --filter @freecorps/brigade-spike-s2 build
# Deploy what was built; the secrets file is outside the repo and holds PROBE_ADMIN_TOKEN=<random>.
cd spikes/s2-probe-placement && bunx wrangler deploy --secrets-file <path>
curl -X POST -H "Authorization: Bearer <token>" https://brigade-probe-dev.<subdomain>.workers.dev/probes/start
PROBE_ADMIN_TOKEN=<token> vpx scripts/report.ts https://brigade-probe-dev.<subdomain>.workers.dev --hours 48
```
