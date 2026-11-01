// Keeps the "I'm on call" widget's snapshot (src/lib/widget.ts) current while a member is signed in: written whenever
// their schedules, overrides, open incidents or the app's language change, when the app comes back to the
// foreground, and every half hour while it stays open (each write restarts the staleness bound). Signing out
// clears it (`clearWidget`). It names the workspace, and carries the member's stretches in the other workspaces this
// phone pages them for as last seen there, kept with each (src/lib/phone-workspaces.ts) on every platform, since the
// on-call screen says "On call in <workspace>" from them too. The widget itself is iOS only.
import { useQuery } from "@freecorps/brigade-sync/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useNow } from "@/components/incident-parts";
import { useLocale } from "@/hooks/use-locale";
import { useInstance } from "@/hooks/use-instance";
import { queriesStatus } from "@/lib/oncall";
import { withShifts } from "@/lib/phone-workspaces";
import { widgetSnapshot, type WidgetSnapshot as Snapshot } from "@/lib/widget";
import { BrigadeWidget } from "../../modules/brigade-widget";

const REFRESH_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function WidgetSnapshot(props: {
  userId: string;
  workspaceId: string;
  workspaceName: string;
}) {
  return <Writer {...props} />;
}

/** The member's stretches in their other workspaces on this phone, still good, for the widget and the on-call screen. */
export function useOtherWorkspaces(
  userId: string,
  workspaceId: string,
): NonNullable<Snapshot["others"]> {
  // The open instance's workspaces; other instances' come with the switcher (RFC 0015 section 5).
  const { phoneWorkspaces } = useInstance();
  const listed = useSyncExternalStore(phoneWorkspaces.subscribe, () =>
    phoneWorkspaces.current(userId),
  );
  const now = Date.now();
  return (listed?.workspaces ?? []).flatMap((workspace) =>
    workspace.id !== workspaceId && workspace.oncall && workspace.oncall.staleAt > now
      ? [{ name: workspace.name ?? "", ...workspace.oncall }]
      : [],
  );
}

function Writer({
  userId,
  workspaceId,
  workspaceName,
}: {
  userId: string;
  workspaceId: string;
  workspaceName: string;
}) {
  const { locale } = useLocale();
  const { phoneWorkspaces } = useInstance();
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const incidents = useQuery("incidents.active", {});
  const tick = useNow(REFRESH_MS);
  const [foreground, setForeground] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setForeground((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);

  const ready = queriesStatus(schedules.status, overrides.status) === "ready";
  const openIncidents = incidents.status === "ready" ? incidents.rows.length : null;
  const others = useOtherWorkspaces(userId, workspaceId);
  const othersKey = JSON.stringify(others);
  const seen = useRef("");
  useEffect(() => {
    // Half-loaded schedules would show the member off call: the last snapshot stays until both are in.
    if (!ready) return;
    const snapshot = widgetSnapshot({
      schedules: schedules.rows,
      overrides: overrides.rows,
      userId,
      now: Date.now(),
      locale,
      openIncidents,
      workspace: workspaceName,
      others: JSON.parse(othersKey) as NonNullable<Snapshot["others"]>,
    });
    // Kept with the workspace for when another one is open: written when the stretches changed, and hourly so how
    // long they hold moves on too.
    const mine = `${JSON.stringify(snapshot.shifts)}@${Math.floor(snapshot.writtenAt / HOUR_MS)}`;
    if (mine !== seen.current) {
      seen.current = mine;
      void phoneWorkspaces.update(userId, (list) =>
        withShifts(list, workspaceId, { shifts: snapshot.shifts, staleAt: snapshot.staleAt }),
      );
    }
    try {
      BrigadeWidget?.setSnapshot(JSON.stringify(snapshot), locale);
    } catch {
      // The widget only goes stale; nothing else depends on it.
    }
  }, [
    phoneWorkspaces,
    ready,
    schedules.rows,
    overrides.rows,
    userId,
    workspaceId,
    workspaceName,
    othersKey,
    locale,
    openIncidents,
    tick,
    foreground,
  ]);
  return null;
}

/** Signing out: the widget forgets the member's shifts and asks to sign in. Never throws. */
export function clearWidget(): void {
  try {
    BrigadeWidget?.clear();
  } catch {
    // An app binary built before the widget.
  }
}
