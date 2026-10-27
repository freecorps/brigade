// Keeps the "I'm on call" widget's snapshot (src/lib/widget.ts) current while a member is signed in: written whenever
// their schedules, overrides, open incidents or the app's language change, when the app comes back to the
// foreground, and every half hour while it stays open (each write restarts the staleness bound). Signing out
// clears it (`clearWidget`). iOS only: elsewhere there is no widget and this does nothing.
import { useQuery } from "@freecorps/brigade-sync/react";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useNow } from "@/components/incident-parts";
import { useLocale } from "@/hooks/use-locale";
import { queriesStatus } from "@/lib/oncall";
import { widgetSnapshot } from "@/lib/widget";
import { BrigadeWidget } from "../../modules/brigade-widget";

const REFRESH_MS = 30 * 60 * 1000;

export function WidgetSnapshot({ userId }: { userId: string }) {
  if (!BrigadeWidget) return null;
  return <Writer userId={userId} />;
}

function Writer({ userId }: { userId: string }) {
  const { locale } = useLocale();
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
    });
    try {
      BrigadeWidget?.setSnapshot(JSON.stringify(snapshot), locale);
    } catch {
      // The widget only goes stale; nothing else depends on it.
    }
  }, [ready, schedules.rows, overrides.rows, userId, locale, openIncidents, tick, foreground]);
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
