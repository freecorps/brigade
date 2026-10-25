#!/usr/bin/env node
// A local stand-in for the external dead-man check (RFC 0007 "Watching the watcher", apps/api src/watchdog.ts):
// it takes the watchdog's pings and says so when they stop, as a healthchecks.io-style service would before
// alerting. For local runs only; a real deployment points DEAD_MAN_URL at a check outside Cloudflare.
//
//   node scripts/dead-man-double.mjs [port] [grace seconds]     # defaults: 8790, 180
//   DEAD_MAN_URL=http://127.0.0.1:8790/ping RELAY_URL=http://127.0.0.1:8790 vp run dev
//
// (From the shell, not apps/api/.dev.vars: apps/web/vite.config.ts passes them to the local API.) Then run the cron
// by hand, since it never fires on its own locally:
//   curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=brigade-api" \
//     -H 'Content-Type: application/json' -d '{"cron":"* * * * *"}'
// A ping only arrives when a relay answered: without RELAY_URL the watchdog stays degraded and stays silent. For a
// local run with no relay, this double answers a relay's `GET /health` too (RELAY_URL=http://127.0.0.1:8790); that
// is not counted as a ping.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8790);
const graceMs = Number(process.argv[3] ?? 180) * 1000;
const started = Date.now();
let lastPing = null;
let pings = 0;
let alerted = false;

const log = (message, fields = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...fields }));

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    return;
  }
  pings += 1;
  lastPing = Date.now();
  if (alerted) log("pings are back", { pings });
  alerted = false;
  log("ping", { method: request.method, path: request.url, pings });
  response.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
}).listen(port, "127.0.0.1", () => log("listening", { url: `http://127.0.0.1:${port}/ping` }));

setInterval(() => {
  const silentMs = Date.now() - (lastPing ?? started);
  if (silentMs > graceMs && !alerted) {
    alerted = true;
    // The real service pages Brigade's operators here, through its own channels.
    log("SILENT: an external check would alert now", {
      silentSeconds: Math.round(silentMs / 1000),
    });
  }
}, 5000);
