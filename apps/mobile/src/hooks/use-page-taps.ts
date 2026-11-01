import { useRouter } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BrigadePush } from "../../modules/brigade-push";
import { useSessionView } from "@/components/session";
import { useActiveInstance } from "@/hooks/use-instance";
import { instances } from "@/lib/instance-clients";
import { activeInstance } from "@/lib/instances";
import { pageInstance } from "@/lib/page-action";
import { incidentByIdRoute, openedPage, tapStep, type OpenedPage } from "@/lib/page-taps";

/**
 * The tapped page waiting to open. Outside React: switching instances or workspaces mounts the app's screens again
 * (the session is keyed on both), and the page must outlive that.
 */
let pending: OpenedPage | null = null;
let switchingTo: string | null = null;

/**
 * Mounted under the session: a page notification tapped on Android (modules/brigade-push Pages.kt) opens its incident,
 * at its own instance (RFC 0015 section 5) and in its own workspace. iOS opens the app on a tap and does not route yet.
 */
export function usePageTaps(): void {
  const router = useRouter();
  const view = useSessionView();
  const clients = useActiveInstance();
  const list = useSyncExternalStore(instances.subscribe, instances.current);
  const workspace = view.kind === "ready" ? view.member.workspaceId : undefined;
  const [tapped, setTapped] = useState(0);
  // Until the stored list is read, only the build's default instance is known: a page from another would be dropped.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void instances
      .load()
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

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
    if (!page || !loaded) return;
    const active = activeInstance(list);
    const target = pageInstance(page, list.instances, active);
    const step = tapStep(
      page,
      { instance: target?.id, active: active?.id },
      workspace,
      switchingTo === page.workspace,
    );
    if (step === "drop") {
      pending = null;
      return;
    }
    if (step === "instance" && target) {
      // The session opens that instance from scratch; the page waits for it.
      void instances.activate(target.id).catch(() => {
        if (pending === page) pending = null;
      });
      return;
    }
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
    if (step === "switch" && clients) {
      switchingTo = page.workspace;
      void clients.authClient.organization
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
  }, [list, clients, workspace, tapped, router, loaded]);
}
