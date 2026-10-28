# RFC 0007 — Multi-region monitoring

- Status: Draft

## Placement

- Regular Workers run near the caller; Cron Triggers run wherever Cloudflare schedules them. Neither gives region control.
- **`ProbeDO` with `locationHint`** (`wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`) — one per
  workspace and region. Hints are best-effort; the DO reports its actual colo (`request.cf.colo` on its outbound
  calls / trace) so the UI shows where checks really ran. Settled by spike S2
  ([docs/spikes/s2-probe-placement.md](../spikes/s2-probe-placement.md)): over 48 hours no probe moved colo, alarms
  missed at most one minute, and egress leaves from the object's colo; `sam`, `afr` and `me` stayed in Miami, London
  and Warsaw, as Cloudflare documents that objects do not spawn in those regions yet. Every alarm run is a new
  instance in the same colo, so a colo change, never a new instance, means a probe moved.
- Each `ProbeDO` uses `alarm()` to run its monitors on schedule (min interval: 30s).
- **Built (first slice):** `ProbeDO` is named `<workspace>:<region>` and created with that hint. Monitors offer only
  the regions where objects spawn in-region (S2, over 48 hours): `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`
  (`PROBE_REGIONS` in `packages/schema`); `sam`, `afr` and `me` are not offered until Cloudflare places objects
  there. Every result carries the colo the probe really ran from (`/cdn-cgi/trace`, fetched once per alarm run), and
  the dashboard shows it next to the region. `apac-ne` (Osaka) and
  `apac-se` (Singapore) also place in-region and are candidates for later regions.
- **The alarm chain never ends on a failure:** every alarm sets the next one before doing anything else (as S2's
  probe did); the workspace shard re-pushes each region's checks every 10 minutes, and at once when an active
  region has reported nothing for 15 minutes, which re-arms a probe whose alarm was lost. The shard's own alarm sets
  a fallback a minute out before its work and moves it to the next deadline after, and an accepted heartbeat ping
  re-arms it if it is missing.
- **Cost of slow targets:** a probe runs at most 6 checks at once (`PARALLEL_CHECKS`), HTTP and TCP together, and
  waits up to the timeout (at most 30 s) for each. Six is also what a Worker allows: at most six connections waiting
  for their headers or to open, the rest queued (and a queued check's timeout would already be running). So a region
  whose targets all time out keeps its object busy, and billed for duration, for about
  `ceil(checks / 6) × timeout` per run instead of a few hundred milliseconds.
- **What one region sustains under hanging targets (decided: documented, not capped lower).** A probe is one object
  per workspace and region, and every check holds one of its six slots until it answers or times out, so when its
  targets hang it completes about `PARALLEL_CHECKS / timeout` checks per second: 0.2 per second, 12 a minute, at the
  30 s maximum timeout. Due checks wait their turn, the most overdue first, so every monitor falls behind evenly
  rather than some starving. A region's result goes stale after `max(3 × interval, 10 min)` (`staleAfterMs`), and a
  monitor with fewer than half its regions fresh shows "No data" (below), which pages nobody (Q17), so falling behind
  shows on the dashboard and never as up; when every monitor of a region is stale the Monitors card also says the
  region stopped reporting. With every target hanging at 30 s, a region keeps about `6 × 600 / 30 = 120` monitors
  fresh whatever their interval (at a 5 s timeout, about 720); past that, some show "No data" until their targets
  answer again. The default cap, 100 monitors per workspace (`MAX_MONITORS_PER_WORKSPACE`), stays under that, so a
  workspace on defaults never goes "No data" for this. `MONITOR_CAP_MAX` (10,000) is not lowered to match: targets
  that answer take a few hundred milliseconds, and a region then runs thousands of checks a minute. An operator who
  raises `MAX_MONITORS` above about 120 trades that: a workspace whose targets hang together sees some monitors as
  "No data" rather than checked late, and only its own probes are slowed (one object per workspace and region), not
  another workspace's.
- **CPU per alarm (built):** an alarm has 30 s of CPU by default (no `limits.cpu_ms` is set). A run takes at most
  `MAX_CHECKS_PER_RUN` (50) due checks, the most overdue first; the rest stay due, and the next alarm comes a second
  later, so a region with thousands of checks runs them across alarms instead of in one. Each check's CPU is bounded
  too: a saved body pattern costs at most `PATTERN_STEPS_PER_CHAR` steps per character of the 64 KiB read (below),
  about 100 ms for the costliest measured, so a run's CPU stays within a few seconds at worst and its wall time (six
  at once, each within its timeout) a few minutes.

## Check types (v1)

- HTTP(S): status, latency, keyword/regex in body, headers, TLS expiry. Built: method `GET` or `HEAD`, the statuses
  that count as up (up to 10 statuses or inclusive ranges, `200, 204, 301-302`; default any 2xx or 3xx; the form
  warns when the list includes a 5xx, which would count a server failure as up), a keyword
  (`GET` only) matched as plain text or as a pattern, up to 10 request headers, interval 30 s to 24 h, timeout 1 to
  30 s. TLS expiry cannot be built in Workers (below). Rows from before ranges keep their one `expectedStatus`, and a
  monitor that uses none of these options pushes its probes the same config as before them, so a deploy restarts no
  probe's streaks.
  - **Method:** still `GET` or `HEAD`, no `POST`. A check runs from up to six regions every 30 s; a `POST` would let a
    monitor call a state-changing endpoint on any public host that often.
  - **Body patterns (decided: restricted syntax, linear engine).** JavaScript's `RegExp` backtracks: `(a+)+$` against
    a few dozen characters takes exponential time, and a Worker cannot stop a running match, so one pattern could pin
    its probe's CPU. A pattern is instead compiled by `packages/schema/src/pattern.ts` into a small program and run as
    a Pike VM (every possible match followed in lockstep, one step per character, no backtracking), so a match costs
    at most the program's length times the body's. Bounds: a pattern of at most 200 characters, a program of at most
    256 instructions once repeats are expanded (`a{3}` is three), repeat counts up to 100, and the 64 KiB the probe
    reads of any body. The program's size is computed before any repeat is expanded, so nested repeats
    (`((a{100}){100}){100}`) are refused without building them, the compiler's own steps are counted, a repeat count is
    read to its closing brace however many digits it has, and repeating something that matches only empty text
    (`(){100}`) is refused.
  - **Cost (decided: fixed when saved).** A pattern's cost is the most steps a match can take per character of the
    body, a property of its program: every instruction visited once, every class tested once, and the classes a
    match can start with added once (`Pattern.cost`, at most twice the program's length). A pattern costing more than
    `PATTERN_STEPS_PER_CHAR` (448) is refused on save ("Pattern could take too long on a large page: use smaller
    repeat counts"; the form says the same), so a saved pattern's work on any body is known: at most 448 × 64 Ki,
    about 29 million steps, and the costliest measured take about 100 ms of CPU. Ordinary patterns cost a few
    hundred: `[^<]{0,100}error` 313, `[^"]{0,80}"status":"down"` 273, `(\w+\s){0,20}outage` 195. (A
    first version gave every pattern a flat 64 steps per character, so these ran out of steps on long pages and every
    check failed and paged.)
  - **A check error does not page (decided).** The match still counts its steps against the pattern's cost and gives
    up past it (`too_slow`), as a safety net no saved pattern reaches unless the cost is wrong. The check is then
    `pattern_slow`, a check error (`CHECK_ERRORS`): Brigade could not judge the body, which says nothing about the
    target. It changes neither the region's streak nor its verdict, so it neither pages nor resolves an alert; the
    region reports it at once with the verdict it left, and the dashboard shows "Check error: pattern too slow" on the
    region and one notice above the list naming the monitors ("they keep their last result and nobody is paged").
    Paging for it would wake someone for Brigade's own limit; the cost is that a target whose body changes while every
    check errors is not judged on its body until the pattern is fixed, though its status, timeout and connection are
    still checked first and still page.
  - **Matching.** Classes are compiled to an ASCII table and sorted ranges searched by halves, the copies a repeat
    makes share one class and ask it once per character, and the threads a match starts with mid-body are walked
    once. A seeded test compares thousands of patterns and bodies with JavaScript's `RegExp` (`u` flag, and `iu` for
    `(?i)`), over text that includes final sigma, the micro sign, sharp s, long s, dotless i and the Kelvin sign.
    Supported: literals, `.`, `\d \w \s` and their negations, escaped punctuation, classes `[a-z]` and `[^…]`, `^`
    and `$` (start and end of what was read), groups (they only group), `|`, `* + ?` and `{n,m}` (a lazy `?` after
    one is accepted and changes nothing), and `(?i)` at the very start to ignore case.
  - **Ignoring case (decided: as `iu`).** Two characters are the same letter when they share a simple case folding,
    as JavaScript's `iu` flags compare them: `ς σ Σ`, `µ μ`, `ß ẞ`, `ſ s S`, the Kelvin sign and `k`, `ϑ θ ϴ`, but not
    `ı` and `i`. At compile time each literal and class is closed under that relation (a negated item such as `\W`
    after closing what it negates, so `\w` takes the Kelvin sign and the long s, as `iu` does), and the body's
    character is then matched as it is. The relation comes from a table derived from the engine's own `RegExp` by
    `packages/schema/scripts/case-fold.ts` (about 1,500 groups, 2.6 KB as runs), which a test derives again on the
    same Unicode version. Comparing the body's character's own cases only, as a first version did, disagreed with
    `iu` whenever folding is not symmetric under upper and lower case. Refused on save, with a reason: backreferences, lookahead and lookbehind, named
    groups and word boundaries, which a linear engine does not run. The same compiler checks a pattern in the
    dashboard, in the shard on save, and in the probe before each check (one the rules no longer take fails as
    `keyword`).
  - **Request headers (decided: not secret, and credentials refused).** Header values are synced with the monitor
    row, like its URL, so every member reads them, viewers too; they are not sealed like webhook secrets. Sealing
    them would need a route that encrypts what a member types before the shard sees it, a server-only table and a key
    in every probe, for a value the probe still sends in clear to a host the monitor names. Instead a check never
    sends `Host` (it would point the request at another site than the URL names), `Authorization`,
    `Proxy-Authorization`, `Cookie`, or a name that reads like a credential (`auth`, `token`, `secret`, `passw`,
    `session`, `cookie`, `credential` or `signature` anywhere in it, `key` as a word, or `api`, `access`,
    `subscription`, `private` or `client` joined to `key` by `-`, `_` or nothing, as in `X-Api-Key`, `access_key`,
    `Ocp-Apim-Subscription-Key` or `X-Hub-Signature-256`); nor the headers the runtime sets (`Content-Length`,
    `Connection`, `Transfer-Encoding`, …), `User-Agent` (checks name Brigade), the ones that claim another client
    (`Forwarded`, `X-Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `True-Client-IP`, `X-Client-IP`, `X-Originating-IP`,
    `Via`, `Proxy-*`, `CF-*`), and the ones that make a proxy route the request elsewhere or as another method
    (`X-Original-URL`, `X-Rewrite-URL`, `X-HTTP-Method-Override`, `X-HTTP-Method`, `X-Method-Override`). Values are printable ASCII, at most 512 characters; at most 10 headers, no name
    twice (`headerProblem`, on save and in the probe). An endpoint that needs credentials gets an unauthenticated
    health path, or a heartbeat. The form says under the list who can read them.
  - **TLS certificate expiry (not built: Workers cannot read the certificate).** `fetch` exposes nothing of the
    server's certificate, and neither does the Sockets API: with `secureTransport: "on"` or after `startTls()`, a
    `Socket` has `readable`, `writable`, `opened`, `closed`, `upgraded`, `secureTransport`, `close()` and `startTls()`,
    and `opened` resolves to a `SocketInfo` with only `remoteAddress` and `localAddress`
    (<https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/> and the runtime's types, October 2026).
    The certificate fields Workers do get (`request.cf.tlsClientAuth`) describe a client certificate presented to
    Cloudflare, not a server's. Reading one ourselves would mean a TLS client in JavaScript over a plain socket (TLS
    1.3 encrypts the server's certificate), and `connect()` cannot reach hosts proxied by Cloudflare anyway. So expiry
    warnings stay out until the runtime exposes the peer certificate.
- **Targets (SSRF):** only `http:` and `https:`, no credentials in the URL, and no host that is private, loopback,
  link-local, shared, reserved or multicast (IPv4 and IPv6 literals, any IPv4 spelling the URL parser normalises),
  nor a local-only name (`localhost`, single-label, `.local`, `.internal`, `.lan`, `.home.arpa`, …). Checked when a
  monitor is saved and again by the probe before every request (`targetProblem`). Also refused: `192.88.99.0/24`
  (6to4 relay), `2001:2::/48` (benchmarking), `2001:10::/28` and `2001:20::/28` (ORCHID, ORCHIDv2) and
  `3fff::/20` (documentation, RFC 9637).
- **Ports (HTTP):** only the default ports, 8080 and 8443, and the other ports Cloudflare proxies HTTP(S) on (2052, 2053,
  2082, 2083, 2086, 2087, 2095, 2096, 8880): `MONITOR_PORTS`. Not "anything above 1024": Redis, Elasticsearch and
  friends listen there, and a check's error (`network` against `timeout`) would tell whether something answers, which
  makes a monitor a port scanner. A health endpoint on another port goes behind a proxy, or uses a heartbeat.
- **Secrets in URLs:** everyone in the workspace can read monitors, viewers included, so a token in a query string
  is visible to all of them. The form says so under the URL field; values are not redacted per role, since the
  query result is the same rows for every member. Redirects are never followed (a
  3xx is the answer), at most 64 KiB of a body is read, and every request has its timeout. A public name that
  resolves to a private address is not caught: Workers cannot resolve names, and `fetch` cannot pin the address it
  connects to, so the protection is Cloudflare's network (deployed Workers cannot reach private networks), not this
  check. Under `wrangler dev`, or workerd run outside Cloudflare, a public name resolving to `127.0.0.1` (or any
  private address) reaches it, and with it the machine's local services; the same holds for outbound webhooks
  (RFC 0005).
- TCP: connect via `connect()` (Sockets API). Built: a host (a name, or an IPv4 or IPv6 address, without a scheme,
  port or path) and a port, interval 30 s to 24 h, timeout 1 to 30 s, regions as for HTTP (`monitor.createTcp`,
  `monitor.updateTcp`; pause and delete are the same mutations for every kind, and a new host, port, timeout or
  region set restarts it like an HTTP target).
  - **Up** means the connection opened (`socket.opened`) within the timeout. Nothing is sent or read, and the socket
    is closed straight after, on every path: opened, refused, failed or timed out. The timeout is the check's own
    timer racing `opened`, so a connection that never answers cannot hold the probe past it; a late rejection is
    handled, never unhandled. A failure is `network` or `timeout`. `network` is a connection that failed: the
    runtime gives one error ("proxy request failed") for a refused port, a name that does not resolve and an address
    Cloudflare refuses, so those three are not told apart. `timeout` is a connection that got no answer. So the
    two do tell a closed port (refused at once) from a filtered one (dropped), and both are kept: that is what an
    operator needs to fix it. Latency is the time to open. Results then vote exactly like HTTP ones (two alike checks per
    region, a majority of fresh regions).
  - **Targets:** the same host rules as HTTP (`hostProblem`, shared by `targetProblem` and `tcpTargetProblems`; the
    host is normalised by the same URL parser, so `127.1` or `2130706433` is loopback here too, and an
    internationalised name is stored in punycode), checked on save and again by the probe before every
    connection. Any port from 1 to 65535 except 25, which Cloudflare refuses for every Worker
    (`TCP_BLOCKED_PORTS`), so a monitor on it could never pass. Also refused: an address in Cloudflare's published
    ranges (<https://www.cloudflare.com/ips/>, copied into `isCloudflareAddress`), since `connect()` to them is
    blocked. A host name proxied by Cloudflare (orange cloud) resolves into those ranges and can never pass
    either, but is not caught on save (Workers cannot resolve names); the form's hint says so.
  - **Why any port, unlike HTTP:** whether something listens on a port is the whole answer of a TCP check, so the
    HTTP allowlist's reason (a check's error must not reveal an open database port) cannot apply without making
    the check useless. What bounds the scanning a monitor could do instead: public hosts only, one host and port per
    monitor, at most one connection per region every 30 s, only owners and admins create monitors, and a cap on the
    monitors per workspace ("Limits" below; 100 unless the instance's operator sets another). The cap is what answers scanning, not the error:
    `network` against `timeout` does tell closed from filtered. Cloudflare's own rules still apply (no Cloudflare
    IP ranges, no private networks, no port 25).
  - **Limits:** a workspace has at most as many monitors, of every kind together, as its cap; every create mutation
    refuses one more with `limit_reached`, and the form says so before sending. The cap (decided) has two levels, so
    it fits a self-hosted instance as well as a hosted one: the instance's, `MAX_MONITORS` in the API's env (1 to
    10000; without it `MAX_MONITORS_PER_WORKSPACE`, 100), which the shard hands every mutation as
    `ctx.limits.monitors` and `GET /features` tells the dashboard as `maxMonitors`; and the workspace's own, set by an
    owner in the Monitors card (`monitor.setCap`: `workspace:manage` and the `owner` role, `monitor.cap_changed`), at
    most the instance's, or none for the instance's. It is stored in its own one-row synced table
    (`monitor_settings`), which the `monitors.cap` query reads, so every member syncs the cap and nothing else of the
    workspace row. A workspace cap above an instance cap lowered later counts as the
    instance's. A cap under the monitors a workspace already has is allowed: they keep running, and no new one is
    added until some are deleted (the form says so). A client's optimistic run does not know the instance's cap and
    leaves that check to the shard. Plans, when they exist, would set the workspace's value. `connect()` counts toward the six connections a Worker may have opening at once (the pool above);
    an open socket keeps a Durable Object alive for up to 15 minutes, which a check never needs since it closes at
    once. Locally (workerd under `vp dev` and the tests) `connect()` reaches loopback, so
    `apps/api/test/monitors.test.ts` checks a real listener and a closed port as well as stubbed sockets. A closed
    port is refused at once there (`network`), but a firewall that drops loopback makes it `timeout`, so the test
    takes either.
  - **IPv6:** the host is stored without brackets, but `connect()` takes an IPv6 address only in brackets
    (`{ hostname: "[2001:db8::1]" }`); a bare one fails like a refused port. Settled in workerd by the same test
    file, which connects to a listener on `::1` both ways (skipped on a machine without an IPv6 loopback), so
    `tcpCheck` adds the brackets. Not yet confirmed against a deployed Worker.
- Heartbeat (push-based): the monitored system calls Brigade; missing beats raise an alert. Covers cron jobs and internal hosts.
  Built: `POST /heartbeat/<workspace id>.<monitor id>.<secret>` (also under the dashboard's `/api`). The secret is
  32 random bytes made by the client, which shows the URL once and sends only its SHA-256; the shard stores the hash
  in a server-only table and compares in constant time. When the
  owner of an address takes back an account someone else signed up with, every heartbeat URL in the workspaces it is
  alone in is revoked (its hash replaced by random bytes) and every monitor there paused (RFC 0002 "Auth"); a new URL
  comes from rotating it (below). The Worker first checks that the workspace exists in D1
  (cached per isolate for 10 minutes), so a made-up workspace creates no Durable Object (Q16); if the D1 read fails, the ping goes to the shard
  anyway (fail open: a D1 outage must not page anyone for a missed beat). Every refusal is the same 404. A ping turns the monitor up;
  no ping within interval + grace (0 s to 24 h) is a failure, found by the workspace shard's alarm (at least once a
  minute), and with one source that is the quorum.
- **Rotating a heartbeat URL** (`monitor.rotateHeartbeat`, owners and admins: `monitor:manage`): for a leaked URL, or
  one revoked by a takeover. As at create, the client makes the secret, shows the URL once and sends only its
  SHA-256; the shard replaces the stored hash in the same transaction, so the old URL gets the same 404 from the next
  ping, and emits `monitor.heartbeat_rotated` (`id` only; the hash stays in the server-only table and is never in a
  synced row or an event). In the dashboard it is New URL in the heartbeat's edit form, confirmed first ("The current
  URL stops working at once; update whatever pings it").
  - **Grace (decided):** rotating starts the monitor over, like a changed HTTP or TCP target: `pending`, its last
    result dropped, `restartedAt` now and the last ping forgotten, so the first deadline is a full interval plus
    grace from the rotation. Whatever pinged the old URL goes quiet the moment it is rotated; without the restart the
    monitor would page on the old ping's deadline while someone is still updating the job. A miss computed before
    the rotation is refused (`restartedAt`), and a firing alert stays (no second one) until the new URL is pinged,
    which resolves it. The cost: a monitor rotated while its job is really broken pages
    one interval plus grace later than it would have. A paused monitor only gets the new hash; resuming restarts it.
- No ICMP. Internal networks only via heartbeat or Cloudflare Tunnel.

## Quorum and flapping

A monitor raises an alert only when **K of N regions** fail for **M consecutive checks** (defaults: 2 of 3, 2 checks).
Recovery uses the same rule. Results feed `AlertGroupDO` as normal `AlertEvent`s, so monitors and external
alerts share routing and dedupe.

Built (first slice): K is a majority and M is 2 (`CONSECUTIVE_CHECKS`): a region's verdict flips after two alike
results (a new monitor is up on its first success).

- **Per monitor (built):** an HTTP or TCP monitor may set its own K (`quorum`, 1 to its number of regions) and M
  (`consecutiveChecks`, 1 to 10), and every kind its incident's severity (`severity`, default SEV2). Left out, a new
  monitor takes the defaults and an edit keeps what the monitor has, so rows from before, and clients that do not know
  the fields, behave as before. With a K, the status turns down when at least K fresh regions are down, and up when
  at least K are up and fewer than K are down; with K at most half the regions both can hold at once, and down wins,
  so a monitor that pages on one region in three stays down while any region is down. Once the freshness floor is
  met (`freshFloor`, below), the K used is `min(K, fresh regions)` (decided): with K equal to the regions, one region
  that stops reporting would otherwise leave the monitor "No data" however down the others see it, and nothing would
  page; now the regions still reporting decide, all of them having to agree. Below the floor it is still "No data",
  so one region never speaks for three. A stored region this deploy no longer probes (one dropped from
  `PROBE_REGIONS` after S2) counts toward nothing: neither the floor, nor the fresh results, nor the sources shown.
  The form warns when K equals the regions (an outage only some regions see never pages) and says how long a region
  takes to count an outage as down (M × the interval). Changing K, M or the severity does not start the checks over:
  a new K applies at the next report or the shard's next alarm (`monitor.evaluate` within a minute, when it changes
  the status), and a new M reaches the probes with the next push, which keeps each region's results, streak and
  verdict (the next result is judged by the new M) and the shard's results. A heartbeat has
  one source, which is always its quorum. The probe reports a region's verdict to the workspace shard when
  it changes, and otherwise every 5 minutes, with the time of its latest check, so the latency, colo and check time stay
  fresh without a shard version per check. Those refreshes change the synced row but are no domain events: the
  mutation is declared `silent` and writes nothing to the outbox; `monitor.checked` is emitted only when a region's
  verdict or failure reason changes.

- **Recent results:** each report also lands in the monitor row's `history`, the last `MONITOR_HISTORY` (96) samples from
  every source in check-time order (source, check time, verdict, latency): about 8 hours of a single source at the
  5-minute refresh, under 3 for three regions, in about 4 KB of synced row. The dashboard draws its latency and
  up/down charts from it, and the status page can later. It is a chart's memory, not a log: it starts over with the
  results (a create, a new target, a resume), and it is never an input to the status, which stays the fresh results'
  vote. Rows from before have none until their next report.

- **Freshness:** a region's result counts for `max(3 × interval, 2 × 5 min)` (`staleAfterMs`; two refresh periods
  at least, since an unchanged verdict is re-sent only every 5 minutes). The status is a majority of the fresh
  results (1 of 1, 2 of 2, 2 of 3, …), and at least half of the monitor's regions, rounded up, must be fresh
  (`freshFloor`): with fewer, a majority of the fresh ones could be one region speaking for three. Below that the
  monitor is `unknown`, shown as "No data", never as up; a new monitor stays `pending` until the window passes. The
  shard's alarm re-evaluates every minute and runs `monitor.evaluate` when results went stale. A heartbeat's result
  never goes stale: the shard reports the missed ping itself.
- **"No data" does not page** (decided, Q17): it opens no incident, since the failure is Brigade's probes, but
  it never resolves a firing alert either (no data is no recovery), the dashboard shows it, and
  `monitor.status_changed` goes to the outbox for notifiers. A down monitor whose probes die stays down-alerted.
  The other side of it: a monitor that goes down _after_ most of its probes died shows `unknown` and does not
  page, even when every surviving region sees it down (an up monitor in three regions whose `enam` and `weur`
  probes went silent, then `wnam` reports down: one fresh result is below the floor of two, so "No data", no
  alert, no incident). An outage that only the surviving probes see is therefore missed until enough regions report
  again. That trade is accepted (Q17); watching Brigade's own probes belongs to the dead-man switch (Q19).
- **Restarts:** creating a monitor, changing its target, resuming it and rotating a heartbeat's URL set `restartedAt`; results from before it are
  refused. A status change does not move it, so a report computed before another region flipped the status and
  delivered after it still counts (no false recovery, no second incident). A monitor's alert goes through the alert
  routes when one names it (below, "Monitor alerts through the routes"), and `AlertGroupDO` is later work (below);
  until then the workspace shard is the alert's home: the server-only mutation `monitor.report`, run as the system actor
  `sys_monitors` (RFC 0004 "Server-side writes"), records the result, and when the quorum turns down it fires one alert
  per monitor (`alerts` table, fingerprint `monitor:<id>`; no second one while it fires) and opens an incident through
  `incident.declare` (the monitor's severity, SEV2 unless it sets one; "<name> is down", in the
  workspace locale (RFC 0008, Q15); or as a route that names it
  says) in the same transaction, so there is never an alert without its
  incident (its `incident.declared` event comes before `alert.fired`). When the quorum turns up again the alert resolves; the incident is left for people, since incidents have no
  timeline yet. Pausing or deleting a monitor resolves its alert too. Every step is an event in the outbox
  (`monitor.*`, `alert.fired`, `alert.resolved`, `incident.declared`). A monitor may name an escalation policy
  (`policyId`): the incident it opens pages through that policy instead of the workspace's default (RFC 0003
  "Escalation policies").

- **`AlertGroupDO` (later; decided: not with monitor routing).** Alert sources (RFC 0005) and monitors keep their
  alerts in the workspace shard, with caps per workspace (20 sources, 50 routes, 200 alerts firing at once, 300
  kept). The firing cap never refuses an alert: closed incidents release theirs, idle quiet ones expire after 24
  hours, and past it a new alert pages as one "Alert capacity reached" alert (RFC 0005 "Alert sources", "Room").
  Monitors add at most one firing alert each (the monitor cap), so routing them adds no volume worth another object;
  and grouping must see an incident's state in the transaction that declares or joins it, which the shard has and an
  `AlertGroupDO` would need an RPC for (with a fallback when it is unreachable, on a paging path). So the shard keeps
  routing, deduplication and grouping. What moves them into an `AlertGroupDO` per fingerprint (or per route group),
  the shard then seeing only the alerts that open or join an incident: a workspace whose alert writes slow its
  shard's other mutations (alerts are a scan of up to 500 rows a payload), or raising `MAX_OPEN_ALERTS` /
  `MAX_ALERT_ROWS` past what one scan should read, or per-source rate limits no longer keeping one sender from
  starving the rest.

- **Monitor alerts through the routes (built).** A monitor that turns down is matched against the workspace's ordered
  routes like an alert source's alert (`fireMonitorAlert` in `packages/schema/src/monitor-alerts.ts`, called by
  `moveTo` in `monitors.ts`), all in the shard and in the report's transaction.
  1. **Matching.** A route's `sourceIds` names alert sources (`src_…`, at most 20) or every source (`sources`,
     `ROUTE_ALL_SOURCES`), and, counted apart, monitors (`mon_…`, at most 100, `MAX_ROUTE_MONITORS`, the default
     monitor cap) or every monitor (`monitors`, `ROUTE_ALL_MONITORS`); the route editor has "Every source" above the
     sources and "Every monitor" above the monitors. A monitor matches only a route that names it or every monitor, so
     routes saved before this never catch one (a catch-all `drop` would otherwise silence monitors that page today).
     An alert source matches a route that names it or every source, or one naming no source and no monitor: an empty
     list keeps meaning every source, so a route saved before keeps its exact meaning. A route naming only monitors
     takes no alert source (the editor says so). Adding monitors never changes which sources a route takes: the editor
     writes every source explicitly (`["sources", "mon_…"]`) when a route that took every source names monitors, and
     saves a route with no monitor as before (`[]`). A monitor's alert matches with its severity (SEV1 critical, SEV2
     high, SEV3 warning, SEV4 info, from the monitor's own) and the labels `monitor` (its name) and `kind` (`http`,
     `tcp`, `heartbeat`), and no other: the editor warns when a `group` route that names monitors groups by another
     label, which would put every monitor it takes into one incident. A route naming a deleted monitor matches nothing
     from it.
  2. **Actions.** `open` declares with the route's severity (else the type's, else the monitor's), type and services,
     and keeps the route in `incident_routes`, so its policy pages first, then the type's, the first service's, the
     monitor's, the default (RFC 0006). `group` joins the open incident of the same group key across `alerts` and `source_alerts` (so
     one route can put a monitor and a Grafana alert labelled with its name in one incident), raising it to the
     monitor's severity if that is higher, and says so on its timeline ("<monitor> went down and was grouped here",
     `alert_grouped`; an alert source's alert grouping onto an incident gets the same line), else opens one.
     **Grouping onto a taken incident (decided).** A page is not sent for an acknowledged incident (apps/api
     `Pager.plan`), so a monitor that joined one would page nobody. So a monitor groups only onto an incident still
     paging: not acknowledged and not `monitoring` (mitigated). When the group's incident is acknowledged or
     mitigated, the monitor opens its own incident through the route instead (holding no group key, so the group keeps
     its incident), whose declaration pages through the route's policy as any `open`; the people on the group's
     incident see both. Alert sources' alerts still group onto a taken incident (their sender repeats, and the
     incident's people asked to be left alone), with the timeline line. `suppress` and `drop` record the alert
     (`outcome`, `routeId`, `routeName` on the `alerts` row) with no incident, and the monitor row keeps a summary
     (`alertRoute`), which the Monitors card shows ("Kept quiet by route …: no incident"). The monitor still holds its
     one alert, so it is not alerted twice while down. Monitors add at most one firing alert each, so their alerts
     stay outside `MAX_OPEN_ALERTS` (the monitor cap bounds them, above).
  3. **Default and fallbacks (paging path).** No route matching declares exactly as before: the monitor's severity, no
     type, no services, the monitor's policy, else the default, and the same rows and events as before (no routing
     field on either). A route naming a deleted type or service is declared without it (`incident.declare` leaves
     it out), one naming a deleted policy had it taken off (`dropPolicyFromRoutes`) and pages through the monitor's
     policy, and a `group` whose incident is closed or gone opens a new one. A routed declare that is refused anyway
     (a route stored with something the declare does not take) falls back to that default declare, and only then
     fails the report (the probe retries), as before. Only the monitor whose alert opened an incident counts as "the
     monitor that opened it" for its policy (RFC 0006 "Who is paged", 4): one grouped onto it never does.
  4. **Recovery and closing (decided).** Recovery, pausing and deleting resolve the monitor's alert whatever a route
     did with it, and note it on the incident it is on. An incident a monitor opened stays for people, as before. One
     an alert source opened that a monitor grouped onto settles when the monitor recovers last as when the source's
     own alert resolves (`settleIncident`, as `sys_alerts`): untouched, it resolves; worked on, it gets the "every
     alert resolved" line. An alert source's resolve does not resolve an untouched incident a monitor is still firing
     on (`settleIncident` counts firing monitor alerts too). **Closing an incident** (resolved or declined) releases
     every monitor alert on it, opened or grouped (`incident.setStatus`, `alert.resolved` with `incident_closed`): the
     monitor lets go of it, and if it is still down its next report (probes send one at least every
     `REPORT_EVERY_MS`, a missed heartbeat too) alerts again through the routes, with a new incident that pages. A
     monitor still down after people resolved its incident is a problem that is not over, and is never silent until it
     recovers; this matches what an alert source's alert sent again does after its incident closed (RFC 0005 "Room").
     Someone who means to stop it pauses the monitor.
  5. **Re-routing.** Monitors do not repeat while down, so `alert.reroute` (in `monitor-alerts.ts`) takes quiet
     monitor alerts too, with the title the shard renders for them: when the routes now do something louder (the
     suppress or drop route deleted, changed, moved below another or disabled by a takeover), the quiet alert resolves
     (`rerouted`) and the monitor fires a new one through them, declared as `sys_monitors`. The shard runs it after
     every route change, for the quiet alerts the routes would now page (`alertsToReroute`), at most 200 a run in
     mutations of 50 (`REROUTE_CHUNK`), the rest on its alarm a tick later. A chunk that fails is run a row at a time,
     and a row that still fails is logged and left for `REROUTE_RETRY_MS` (10 minutes) before the alarm tries it again,
     so one bad row never keeps the others from paging, and a deleted suppress route never leaves a down monitor
     unpaged until it recovers.
  6. **Tests.** `packages/schema/tests/monitor-alerts.test.ts`: routes saved before never match a monitor and keep
     their sources, every source beside monitors, the separate caps, today's rows and events unchanged with no route,
     each action, the route's, a service's and the monitor's policy, a grouped monitor's policy never paging, a
     deleted policy, type or service and a refused declare each still paging, the timeline line for a grouped alert, a
     monitor opening its own incident beside an acknowledged or mitigated one, a grouped incident held by a down
     monitor and settled by its recovery, closing an incident a down monitor opened or grouped onto (it alerts again),
     and re-routing; `packages/schema/tests/webhooks.test.ts` (a quiet alert's resolve reaches no receiver);
     `apps/web/test/alerts-card.test.tsx` (adding monitors keeps a route's sources, the group warning);
     `apps/api/test/monitors.test.ts` ("a down monitor a deleted suppress route kept quiet is paged by the shard alarm
     if routing it again failed", "quiet monitor alerts are routed again in chunks, a run at a time, and a row that
     fails alone waits").

## Watching the watcher

- External dead-man switch (built; `apps/api/src/watchdog.ts`). Brigade cannot page about its own outage, so a check
  outside Cloudflare's failure domain does: it expects a ping every minute and alerts the instance's operators through
  its own channels when the pings stop. What pings is not "the Worker is up" but the paging pipeline end to end:
  1. A Cron Trigger (`* * * * *`, the API Worker's `scheduled`) asks the one `WatchdogDO` (named `watchdog`) for a
     beat: a `brigade.heartbeat` event written to the watchdog's own outbox, and its alarm armed.
  2. The alarm drains it with the same `OutboxDrain` as the shards to the `brigade-events` Queue.
  3. The Queue consumer routes the watchdog's events (`workspaceId` `_system`, which no workspace can have) away from
     the shards: for a heartbeat it asks the relay's **deep health check** (decided, Q19): `GET /health?deep=1` with
     the bearer send token (5 s timeout). The deep check is only for the send token's holder (`401` otherwise, so its
     detail is never public; the plain `/health` stays `{ ok: true }`). It proves the token, and asks each push provider
     whether it would take a page without sending one: APNs gets the relay's cached provider token on a request for a
     device that cannot exist (all zeros), so `400 BadDeviceToken` means it took the token, and so does `429 TooManyRequests` (that
     device token rate-limited; `429 TooManyProviderTokenUpdates` is the provider token refreshed too often, which
     pages would hit too, so an error), while `403 InvalidProviderToken` / `ExpiredProviderToken` means
     the key is revoked or wrong. Only the host of the relay's `APNS_ENVIRONMENT` is asked: one key signs for both
     hosts, so a key one takes the other takes too. FCM is asked for an OAuth access
     token for `FCM_SERVICE_ACCOUNT`, a fresh one each time (each provider gets 3 s, inside the consumer's 5 s) (`not_configured` without it: a relay serving iOS only). A relay from
     before the deep check answers its plain `/health` there; then the consumer falls back to proving the token as
     before (`POST /send` with no body: `400 invalid_body` means accepted, before any APNs call or log), and the
     providers are `unknown`. Beside it the consumer makes **one cheap D1 read** (`select 1`, 3 s). It reports all of
     it back to the watchdog (`proved`).
  4. The watchdog pings `DEAD_MAN_URL` (one `GET`, 5 s timeout) only when that beat is newer than any proved before,
     came back within 2 minutes, the relay took the token, and none of the deeper checks failed: a revoked APNs key,
     an FCM account Google refuses, or a D1 that does not answer stops the pings, so the operators hear of it (a
     provider `not_configured` or `unknown` does not). A failure that will not pass by itself (APNs refusing the
     provider token, a key that will not sign, Google refusing the account) counts on its first beat. One that may (the
     relay marks it `transient`: a provider timing out or answering 5xx, Google's token endpoint slow or busy; and any
     failed D1 read) counts only on the **3rd proved beat in a row** it fails (`TRANSIENT_FAILURES_TO_DEGRADE`, a count
     per check in the watchdog's storage): before that the beat still pings and the status does not change, so one
     slow answer does not page the operators. A check that passes starts its count again, so a provider failing two beats in three never degrades (accepted:
     the pages themselves are retried, and a lasting outage fails three in a row). Anything else is silence.
     The ping runs in the object's `waitUntil`, so a check that hangs never holds up the consumer and the pages in its
     batch.

  So a stop anywhere (the cron, Durable Objects, alarms, the drain, the Queue, the consumer, the relay) stops the
  pings within a minute or two. The operator's check sets its own period (1 minute) and grace (we suggest 5 minutes)
  and its own alert channels; any service or self-hosted checker that alerts on a missed URL ping works
  (healthchecks.io-style), so Brigade names none. `DEAD_MAN_URL` is an optional secret (`https:`; `http:` only on
  loopback, for the local double `scripts/dead-man-double.mjs`); without it everything else still runs and nothing is
  pinged. A failed ping is logged and recorded; the next proved beat tries again.

  Inside Brigade the same state is `GET /health/paging` (never a URL or an id): without a session, or for a user in
  no workspace, only `{ status }` (`ok`, `degraded` or `unknown`), since why and since when would tell an outsider when
  pages stop going out; for any member of a workspace also the reasons and the times, since a responder needs to know
  they may not be paged. `external` (whether the check is configured and the last ping) is never sent: it is the
  instance operator's business, and with open sign-up any user can own a workspace, so no workspace role stands in for
  that operator (Q19); operators read it in the logs. The dashboard asks with the session's cookie and shows a notice above the incidents while it is not
  `ok` (nothing while it is), checking every minute while the tab is visible. `degraded` means: no beat for 3 minutes
  (`no_beat`); the newest proved beat, by when the cron wrote it, older than 3 minutes (`pipeline_stalled`: beats
  stopped coming through, or come through late from a backed-up Queue); the last proof took over 2 minutes
  (`pipeline_slow`, which is also why it pinged nothing, so the dashboard and the external check agree); or the relay
  refused the token (`relay_unauthorized`), did not answer (`relay_unreachable`) or is not configured
  (`relay_not_configured`) on the last proof; or its deeper checks failed as above (at once, or on the 3rd beat in a
  row): APNs (`apns_failing`), FCM (`fcm_failing`) or the D1 read (`d1_failing`). `unknown` is before the first proof (a new deployment; local runs, where
  the cron only fires by hand). The watchdog itself unreachable is a 503, which the dashboard shows as "couldn't
  check". Each change of status or reasons on a beat or a proof is a `brigade.status_changed` event in the watchdog's
  outbox and a log line (`paging pipeline degraded`). The consumer emails it to the instance's operators (decided,
  Q19): `OPERATOR_EMAILS`, comma-separated, at most 10 addresses, through the email notifier's sender, in English (no
  operator has a locale; the strings are in `packages/i18n` with `pt-BR` too). At most `OPERATOR_EMAIL_HOURLY_CAP` (6)
  changes an hour are emailed, each once (the watchdog claims it, so a redelivery sends nothing); a failed send is
  logged, never retried, and never holds up the pages in its batch. `no_beat` never is: a beat or a proof is what
  records a change, and no beat means neither runs, so only `GET /health/paging` and the external check see it.
  Tests: `apps/relay/test/deep-health.test.ts`, `apps/api/test/watchdog.test.ts` ("a relay with the deep check: …",
  "a transient deep-check failure …", "OPERATOR_EMAILS are emailed …").

  Not covered: each workspace shard's own alarm and outbox (the watchdog proves the shared code and the shared
  Queue, not every shard's drain), which waits on a registry of shards, and whether APNs delivers (the deep check
  stops at the provider token). See open question Q19.

- Internal self-check: a DO alarm verifies every `ProbeDO` reported recently and alerts on stalled probes.
  Built so far: the workspace shard's alarm logs a stalled region and pushes its config again, and a monitor whose
  regions all go quiet turns "No data"; it does not page (Q17). The dashboard's Monitors card says when a region
  stalled, as one notice above the list ("Checks from US East stopped reporting…"): a region where every running
  HTTP or TCP monitor has gone past its stale window (`stalledRegions`), from the synced rows alone, so it needs no new
  state. One quiet monitor is that monitor, not the probe, and says nothing.

## Notes

- HTTP probes originate from Cloudflare IPs (<https://www.cloudflare.com/ips/>); TCP checks come from a separate
  prefix that is not in that list, and Cloudflare does not publish it as an allowlist. Targets behind strict
  firewalls should use heartbeats. TCP checks cannot reach Cloudflare's own ranges, so hosts proxied by Cloudflare
  cannot be checked over TCP.
- Targets hosted on the same Cloudflare account are reached through Cloudflare's network; this checks the public path
  through Cloudflare, not the origin directly. Add a separate check against the origin when needed.
