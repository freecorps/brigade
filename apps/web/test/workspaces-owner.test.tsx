// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vite-plus/test";
import {
  currentWorkspaces,
  loadWorkspaces,
  ownWorkspaces,
  resetWorkspaces,
  useWorkspaces,
} from "../src/lib/workspaces";

const ACME = [{ id: "ws_1", name: "Acme", role: "owner" as const }];

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
