/** A request body far above any valid call: a device token and a sealed 2 KB plaintext. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Reads at most `MAX_BODY_BYTES`, whether or not the request declares its length: the bytes (empty without a body),
 * or null when it is too large or its stream broke.
 */
export async function readBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // The client's stream broke mid-body: a bad request, not a relay error.
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The body as JSON, or null when it is missing, too large or not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  const bytes = await readBody(request);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
