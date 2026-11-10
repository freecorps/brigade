// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  currentWorkspaces,
  loadWorkspaces,
  ownWorkspaces,
  resetWorkspaces,
  useMembers,
  useWorkspaces,
} from "../src/lib/workspaces";

const ACME = [{ id: "ws_1", name: "Acme", role: "owner" as const }];

// No request leaves the test: a hook's own loads wait forever unless a test answers them.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function Shown({ userId }: { userId: string | undefined }) {
  const workspaces = useWorkspaces(userId);
  return <span>{workspaces.active?.name ?? "none"}</span>;
}

test("every reader shows only the signed-in account's list: another account's, or nobody's, is none", async () => {
  resetWorkspaces();
  const answer = (async () => Response.json({ workspaces: ACME })) as typeof fetch;
  ownWorkspaces("usr_ana", answer);
  await loadWorkspaces(answer);
  expect(currentWorkspaces()).toEqual({ owner: "usr_ana", list: ACME });

  const element = document.createElement("div");
  const root = createRoot(element);
  // Ana's list for Ana (the header, the switcher, the account menu all read it this way).
  await act(async () => root.render(<Shown userId="usr_ana" />));
  expect(element.textContent).toBe("Acme");
  // Signed out, or still reading the session: none, not the list before.
  await act(async () => root.render(<Shown userId={undefined} />));
  expect(element.textContent).toBe("none");
  await act(async () => root.unmount());
  // Bia signed in in this tab: never Ana's workspace, even on a page with no other reader (an invitation).
  resetWorkspaces();
  ownWorkspaces("usr_ana", answer);
  await loadWorkspaces(answer);
  const other = createRoot(element);
  await act(async () => other.render(<Shown userId="usr_bia" />));
  expect(element.textContent).toBe("none");
  expect(currentWorkspaces().owner).toBe("usr_bia");
  await act(async () => other.unmount());
});

function Members({ workspaceId }: { workspaceId: string }) {
  const listed = useMembers(workspaceId);
  if (listed.error) return <span>error</span>;
  return <span>{listed.members?.map((one) => one.name).join(",") ?? "loading"}</span>;
}

test("members are always the shown workspace's: no failure or late answer carries over from another", async () => {
  const answers = new Map<string, (response: Response) => void>();
  globalThis.fetch = ((input: string) =>
    new Promise<Response>((resolve) => answers.set(String(input), resolve))) as typeof fetch;
  const member = (name: string) => ({
    userId: `usr_${name}`,
    role: "responder",
    user: { name, email: `${name}@acme.test` },
  });
  const element = document.createElement("div");
  const root = createRoot(element);
  await act(async () => root.render(<Members workspaceId="ws_1" />));
  await act(async () =>
    answers.get("/api/workspaces/ws_1/members")!(new Response(null, { status: 503 })),
  );
  expect(element.textContent).toBe("error");
  // Another workspace: loading, not the failure before.
  await act(async () => root.render(<Members workspaceId="ws_2" />));
  expect(element.textContent).toBe("loading");
  await act(async () =>
    answers.get("/api/workspaces/ws_2/members")!(Response.json({ members: [member("bia")] })),
  );
  expect(element.textContent).toBe("bia");
  // Back to the first while its answer is late, then on to a third: the first's answer never shows there.
  answers.clear();
  await act(async () => root.render(<Members workspaceId="ws_1" />));
  await act(async () => root.render(<Members workspaceId="ws_3" />));
  await act(async () =>
    answers.get("/api/workspaces/ws_1/members")!(Response.json({ members: [member("ana")] })),
  );
  expect(element.textContent).toBe("loading");
  await act(async () => root.unmount());
});
