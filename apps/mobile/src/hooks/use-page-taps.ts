import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BrigadePush } from "../../modules/brigade-push";
import { useSessionView } from "@/components/session";
import { authClient } from "@/lib/auth-client";
import { incidentByIdRoute, openedPage, tapStep, type OpenedPage } from "@/lib/page-taps";

/**
 * The tapped page waiting to open. Outside React: switching workspaces mounts the app's screens again (the session
 * is keyed on the workspace), and the page must outlive that.
 */
let pending: OpenedPage | null = null;
let switchingTo: string | null = null;

/**
 * Mounted under the session: a page notification tapped on Android (modules/brigade-push Pages.kt) opens its incident,
 * in its own workspace. iOS opens the app on a tap and does not route yet.
 */
export function usePageTaps(): void {
  const router = useRouter();
  const view = useSessionView();
  const active = view.kind === "ready" ? view.member.workspaceId : undefined;
  const [tapped, setTapped] = useState(0);

  useEffect(() => {
    const module = BrigadePush;
    if (process.env.EXPO_OS !== "android" || !module?.takeOpenedPage) return;
    const take = (value: unknown) => {
      const page = openedPage(value);
      if (!page) return;
      pending = page;
      setTapped((n) => n + 1);
    };
    take(module.takeOpenedPage());
    const subscription = module.addListener?.("onOpenPage", take);
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    const page = pending;
    if (!page) return;
    const step = tapStep(page, active, switchingTo === page.workspace);
    if (step === "open") {
      pending = null;
      switchingTo = null;
      // After the stack has mounted: expo-router refuses to navigate before the root layout has.
      let opened = false;
      const timer = setTimeout(() => {
        opened = true;
        router.navigate(incidentByIdRoute(page.incident));
      }, 0);
      // Cancelled before it ran (a re-render, a remount): the page waits again, for the next run or mount to open.
      return () => {
        clearTimeout(timer);
        if (!opened && pending === null) pending = page;
      };
    }
    if (step === "switch") {
      switchingTo = page.workspace;
      void authClient.organization
        .setActive({ organizationId: page.workspace })
        .then((result) => {
          // Not a member there any more, or offline: the app stays where it is and the page is dropped.
          if (result.error && pending === page) pending = null;
        })
        .catch(() => {
          if (pending === page) pending = null;
        })
        .finally(() => {
          if (switchingTo === page.workspace) switchingTo = null;
        });
    }
    return undefined;
  }, [active, tapped, router]);
}
