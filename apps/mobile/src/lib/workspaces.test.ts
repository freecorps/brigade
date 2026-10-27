import { expect, test } from "vite-plus/test";
import { createWorkspace } from "./workspaces";

const URL = "http://localhost:5173/api/workspaces";

test("a workspace is created with the member's session, and its id is answered", async () => {
  let sent: RequestInit | undefined;
  const result = await createWorkspace(URL, "Platform", "session=abc", async (_url, init) => {
    sent = init;
    return Response.json({ id: "ws_1", name: "Platform" }, { status: 201 });
  });
  expect(result).toEqual({ ok: true, id: "ws_1" });
  expect(sent?.method).toBe("POST");
  expect(new Headers(sent?.headers).get("cookie")).toBe("session=abc");
  expect(sent?.body).toBe(JSON.stringify({ name: "Platform" }));
});

test("a refusal carries the API's code, and no answer is status 0", async () => {
  const limited = await createWorkspace(URL, "x", "", async () =>
    Response.json({ error: "workspace_limit" }, { status: 403 }),
  );
  expect(limited).toEqual({ ok: false, status: 403, error: "workspace_limit" });
  const offline = await createWorkspace(URL, "x", "", () => Promise.reject(new Error("offline")));
  expect(offline).toEqual({ ok: false, status: 0 });
  const odd = await createWorkspace(URL, "x", "", async () => Response.json({}, { status: 201 }));
  expect(odd).toEqual({ ok: false, status: 502 });
});
