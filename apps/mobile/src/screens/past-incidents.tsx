import { Column, FieldGroup, Row, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import { formatAge } from "@freecorps/brigade-i18n/incident";
import { formatIncidentNumber, OLDER_DAYS, PAST_DAYS, pastSince } from "@freecorps/brigade-schema";
import { nextFailed, syncView } from "@freecorps/brigade-sync";
import { useConnectionState, useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, spacing } from "@freecorps/brigade-ui";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { EmptyRow } from "@/components/empty-row";
import type { Glyph } from "@/components/glyphs";
import { StateLines, useNow } from "@/components/incident-parts";
import { ListItem } from "@/components/list-item";
import { useListEnd } from "@/components/list-end";
import { ListStatus } from "@/components/list-status";
import { NativeHost } from "@/components/native-host";
import { SeverityPill, StatusPill } from "@/components/pill";
import { RowChevron } from "@/components/row-chevron";
import { RowText } from "@/components/row-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";

/** Nothing in the window: a clock turning back, for history. */
const HISTORY_GLYPH: Glyph = { ios: "clock.arrow.circlepath", android: "history", web: "history" };

/**
 * Incidents that are over (`incidents.past`): resolved or declined, declared in the last `PAST_DAYS` days, newest
 * first; a row opens its incident, where it can be reopened. "Show older" goes `OLDER_DAYS` further back.
 */
export function PastIncidents() {
  // A refused list is asked for again only by a new subscriber: "Reload" remounts the list.
  const [attempt, setAttempt] = useState(0);
  return <PastList key={attempt} onReload={() => setAttempt((n) => n + 1)} />;
}

function PastList({ onReload }: { onReload: () => void }) {
  const colors = useTheme();
  const { locale } = useLocale();
  const now = useNow(60_000);
  const [days, setDays] = useState(PAST_DAYS);
  // Fixed while the screen is open: a new `since` would ask the shard again.
  const [opened] = useState(() => Date.now());
  const { rows, status, error } = useQuery("incidents.past", { since: pastSince(days, opened) });
  // As the open incidents: connecting, live, reconnecting, unavailable (never answered) or refused.
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);
  const listEnd = useListEnd();
  return (
    <View style={{ flex: 1 }}>
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Column spacing={spacing[1]} alignment="start">
                <ListStatus view={view} summary={m.incidents_past_window({ days })} />
                <StateLines view={view} errorCode={error?.code} />
              </Column>
            </FieldGroup.SectionHeader>
            {rows.map((row) => (
              <ListItem
                key={row.id}
                onPress={
                  row.number === null
                    ? undefined
                    : () =>
                        router.push({
                          pathname: "/incidents/[number]",
                          params: { number: String(row.number) },
                        })
                }
                trailing={row.number === null ? undefined : <RowChevron />}
              >
                <Column spacing={spacing[1] + spacing[0.5]} alignment="start">
                  <Text numberOfLines={2} textStyle={{ fontWeight: "600" }}>
                    {row.title}
                  </Text>
                  <Row spacing={spacing[1] + spacing[0.5]} alignment="center">
                    <SeverityPill severity={row.severity} />
                    <StatusPill status={row.status} />
                    <Text
                      numberOfLines={1}
                      textStyle={{ color: colors.mutedForeground, fontSize: fontSize.sm.size }}
                    >
                      {[
                        formatIncidentNumber(row.number) ?? "",
                        formatAge(Math.min(row.declaredAt, now), now, locale),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </Row>
                </Column>
              </ListItem>
            ))}
            {rows.length === 0 && status === "ready" ? (
              <EmptyRow
                title={m.incidents_past_title()}
                description={m.incidents_past_empty({ days })}
                glyph={HISTORY_GLYPH}
              />
            ) : null}
          </FieldGroup.Section>
          {view === "refused" ? (
            <FieldGroup.Section>
              <ListItem onPress={onReload}>
                <RowText color={colors.primary}>{m.reload()}</RowText>
              </ListItem>
            </FieldGroup.Section>
          ) : null}
          {status === "ready" ? (
            <FieldGroup.Section>
              <ListItem onPress={() => setDays((current) => current + OLDER_DAYS)}>
                <RowText color={colors.primary}>{m.incidents_past_older()}</RowText>
              </ListItem>
            </FieldGroup.Section>
          ) : null}
          {listEnd}
        </FieldGroup>
      </NativeHost>
    </View>
  );
}
