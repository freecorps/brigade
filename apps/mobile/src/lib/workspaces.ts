// Creating a workspace from the app (the account section's New workspace, and an account without one): the
// dashboard's `POST /api/workspaces` with the member's session, which makes the new workspace active in it. Pure, so
// it is tested in Node; src/components/new-workspace.tsx runs it.

export type CreateResult =
  | { ok: true; id: string }
  /** `status` 0: no answer (offline). `error`: the API's code, such as `workspace_limit`. */
  | { ok: false; status: number; error?: string };

export async function createWorkspace(
  url: string,
  name: string,
  cookie: string,
  fetcher: typeof fetch = fetch,
): Promise<CreateResult> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", cookie },
      body: JSON.stringify({ name }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  const body: unknown = await response.json().catch(() => null);
  const field = (key: string) =>
    typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
  if (response.status !== 201) {
    const error = field("error");
    return { ok: false, status: response.status, ...(typeof error === "string" ? { error } : {}) };
  }
  const id = field("id");
  return typeof id === "string" ? { ok: true, id } : { ok: false, status: 502 };
}
