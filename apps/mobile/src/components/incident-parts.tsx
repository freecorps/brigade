// Pieces the incident list and the incident screen share: badges that open a choice, refusal notices, the
// connection line and what to say when sync is stale or missing.
import { queryErrorReason } from "@freecorps/brigade-i18n/incident";
import { m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import type { SyncView } from "@freecorps/brigade-sync";
import { fontFamily, fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { SymbolView } from "expo-symbols";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Badge, useGlyphSize } from "@/components/badge";
import { SEV1_GLYPH, STATUS_GLYPHS, type Glyph } from "@/components/glyphs";
import { useOnline } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

const CHANGE_GLYPH: Glyph = {
  ios: "chevron.up.chevron.down",
  android: "unfold_more",
  web: "unfold_more",
};

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const colors = useTheme();
  return (
    <Badge
      colors={colors.status[status]}
      icon={STATUS_GLYPHS[status]}
      label={incidentStatusLabels[status]()}
    />
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const colors = useTheme();
  return (
    <Badge
      colors={colors.severity[severity]}
      code={severity.toUpperCase()}
      icon={severity === "sev1" ? SEV1_GLYPH : undefined}
      label={severityLabels[severity]()}
    />
  );
}

/** A badge that opens a choice: one button, read as "Status: Investigating". */
export function Choice({
  label,
  value,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  /** The current value, spoken after the label. */
  value: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const colors = useTheme();
  const glyph = useGlyphSize(fontSize.sm.size);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={disabled ? undefined : m.mobile_change_hint()}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // The badge is short; the hit area is at least 44 points tall.
      hitSlop={spacing[2]}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {children}
      {disabled ? null : (
        <SymbolView name={CHANGE_GLYPH} tintColor={colors.mutedForeground} size={glyph} />
      )}
    </Pressable>
  );
}

export function Notice({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  const colors = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.destructive,
      }}
    >
      <ThemedText selectable style={{ flex: 1, color: colors.destructive }}>
        {children}
      </ThemedText>
      {/* 48 dp tall and wide, centred on the first line of the message. */}
      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        style={({ pressed }) => ({
          minHeight: spacing[12],
          minWidth: spacing[12],
          marginVertical: -spacing[3],
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ThemedText style={{ color: colors.primary }}>{m.dismiss()}</ThemedText>
      </Pressable>
    </View>
  );
}

const CONNECTION: Record<
  SyncView,
  { text: () => string; glyph?: Glyph; tone: "ok" | "muted" | "bad" }
> = {
  // From the socket's state. The sync client's heartbeat drops a half-open socket (the network gone without a
  // close) within about 35 s, so it turns to reconnecting instead of staying Live (RFC 0004 "Heartbeat").
  live: { text: m.sync_live, tone: "ok" },
  connecting: { text: m.sync_connecting, tone: "muted" },
  reconnecting: {
    text: m.sync_reconnecting,
    glyph: { ios: "arrow.clockwise", android: "sync", web: "sync" },
    tone: "muted",
  },
  unavailable: {
    text: m.sync_unavailable,
    glyph: { ios: "exclamationmark.circle", android: "error", web: "error" },
    tone: "bad",
  },
  refused: {
    text: m.sync_refused,
    glyph: { ios: "exclamationmark.circle", android: "error", web: "error" },
    tone: "bad",
  },
};

/** Not live because the phone itself has no network: said as that, not as Brigade being unavailable. */
const OFFLINE = {
  text: () => m.mobile_session({ part: "offline" }),
  glyph: { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } satisfies Glyph,
  tone: "muted" as const,
};

/** What the connection line says for `view`: its word, its glyph (none for a dot), and their colour. */
export function useConnection(view: SyncView) {
  const colors = useTheme();
  const online = useOnline();
  const { text, glyph, tone } =
    online || view === "live" || view === "refused" ? CONNECTION[view] : OFFLINE;
  const color =
    tone === "ok" ? colors.primary : tone === "bad" ? colors.destructive : colors.mutedForeground;
  return { text: text(), glyph, tone, color };
}

/** Calm by design: a word and a small glyph, never a banner, since a reconnect usually fixes itself. */
export function ConnectionStatus({ view }: { view: SyncView }) {
  const colors = useTheme();
  const glyphSize = useGlyphSize(fontSize.sm.size);
  const { text, glyph, tone, color } = useConnection(view);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}
    >
      {glyph ? (
        <SymbolView name={glyph} tintColor={color} size={glyphSize} />
      ) : (
        <View
          style={{
            width: spacing[2],
            height: spacing[2],
            borderRadius: spacing[1],
            backgroundColor: color,
          }}
        />
      )}
      <ThemedText variant="label" style={{ color: tone === "ok" ? colors.foreground : color }}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Below the list or above the incident: why it is stale or missing, and what happens next. */
export function StatePanel({
  view,
  errorCode,
  onReload,
  subject = "list",
}: {
  view: SyncView;
  errorCode: string | undefined;
  onReload: () => void;
  /** What is on screen: the incident list, or one incident. */
  subject?: "list" | "incident";
}) {
  const colors = useTheme();
  if (view === "reconnecting") {
    return (
      <ThemedText variant="caption">
        {subject === "incident"
          ? m.mobile_session({ part: "incident_stale_hint" })
          : m.sync_reconnecting_hint()}
      </ThemedText>
    );
  }
  if (view !== "unavailable" && view !== "refused") return null;
  return (
    <View style={{ gap: spacing[2] }}>
      {view === "refused" ? (
        <>
          <ThemedText selectable>
            {m.sync_refused_hint({ reason: queryErrorReason(errorCode) })}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={onReload} hitSlop={spacing[3]}>
            <ThemedText style={{ color: colors.primary }}>{m.reload()}</ThemedText>
          </Pressable>
        </>
      ) : __DEV__ ? (
        <>
          <ThemedText selectable>{m.sync_unavailable_hint()}</ThemedText>
          <ThemedText selectable style={{ fontFamily: Platform.select(fontFamily.native.mono) }}>
            vp run dev
          </ThemedText>
          <ThemedText variant="caption">{m.mobile_sync_retrying()}</ThemedText>
        </>
      ) : (
        <>
          <ThemedText selectable>{m.mobile_sync_offline_hint()}</ThemedText>
          <ThemedText variant="caption">{m.mobile_sync_retrying()}</ThemedText>
        </>
      )}
    </View>
  );
}

/** Epoch ms, refreshed every `ms`, so relative times move on their own. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
