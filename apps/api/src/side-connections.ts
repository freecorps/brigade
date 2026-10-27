// The side notifiers' share of a queue invocation's connections (RFC 0005 "Outbound webhooks"). A Worker invocation
// keeps at most six connections open at once, and a seventh subrequest waits for one to close
// (https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections). One batch carries pages
// and, beside them, Slack posts and webhook deliveries to receivers Brigade does not run: twenty endpoints that never
// answer would otherwise hold all six for their whole timeout, and a page's relay request through `RELAY_URL` would
// wait behind them. So Slack and webhooks share `SIDE_CONNECTIONS` slots per invocation, and the relay always finds
// one free.

/** Connections Slack and webhooks may hold at once in one invocation: half of six, so the relay never waits. */
export const SIDE_CONNECTIONS = 3;
/**
 * Slack's own share of those (RFC 0011): an incident channel with its invitations, both messages and the timeline
 * mirror is several calls per event, and they must not take every side slot from the webhooks either.
 */
export const SLACK_CONNECTIONS = 2;
/** The most of a side call's answer read before its slot is freed; Slack's answers are a few KB. */
export const SIDE_RESPONSE_BYTES = 256 * 1024;
/** How long reading a side call's answer may take once it arrived, so a stalled body never keeps its slot. */
export const SIDE_READ_MS = 5000;

export type Fetch = (request: Request) => Promise<Response>;

/** A deadline passed before a slot was free: the work never started, so it is no attempt. */
export class NotStarted extends Error {
  override name = "NotStarted";
}

/** One invocation's side slots. Not shared across invocations: each queue batch makes its own. */
export class SideConnections {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max = SIDE_CONNECTIONS) {}

  /** Slots in use now (for tests). */
  get inUse(): number {
    return this.active;
  }

  /**
   * Runs `work` once a slot is free and frees it when `work` settles. `work` must not leave a connection open when it
   * settles (read or cancel the body). Past `deadline` (epoch ms) without a slot, rejects with `NotStarted`.
   */
  async run<T>(work: () => Promise<T>, deadline?: number): Promise<T> {
    await this.acquire(deadline);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /**
   * `send` within a slot: the answer's body is read (at most `SIDE_RESPONSE_BYTES`, the rest cancelled) before the
   * slot is freed, so the connection is closed when the caller gets the response. The request's own signal bounds
   * the wait for the answer; `SIDE_READ_MS` bounds the read.
   */
  wrap(send: Fetch): Fetch {
    return (request) =>
      this.run(async () => {
        const response = await send(request);
        const body = await readBounded(response, SIDE_RESPONSE_BYTES, SIDE_READ_MS);
        return new Response(NULL_BODY.includes(response.status) ? null : body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      });
  }

  private acquire(deadline: number | undefined): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grant = () => {
        clearTimeout(timer);
        this.active++;
        resolve();
      };
      this.waiting.push(grant);
      if (deadline !== undefined) {
        timer = setTimeout(
          () => {
            const index = this.waiting.indexOf(grant);
            if (index === -1) return;
            this.waiting.splice(index, 1);
            reject(new NotStarted("no free connection before the deadline"));
          },
          Math.max(0, deadline - Date.now()),
        );
      }
    });
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

/** Statuses whose response has no body (`new Response` refuses one). */
const NULL_BODY = [101, 204, 205, 304];

/** Up to `max` bytes of `response`'s body; the rest is cancelled unread. Past `ms` the read is cancelled. */
async function readBounded(response: Response, max: number, ms: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the answer took too long to read")), ms);
  });
  aborted.catch(() => undefined);
  try {
    while (length < max) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      const chunk = value.byteLength > max - length ? value.subarray(0, max - length) : value;
      chunks.push(chunk);
      length += chunk.byteLength;
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
