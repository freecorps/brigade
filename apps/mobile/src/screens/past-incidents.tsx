import { Column, FieldGroup, Row, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import { formatAge, queryErrorReason } from "@freecorps/brigade-i18n/incident";
import { formatIncidentNumber, OLDER_DAYS, PAST_DAYS, pastSince } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, spacing } from "@freecorps/brigade-ui";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { EmptyRow } from "@/components/empty-row";
import type { Glyph } from "@/components/glyphs";
import { useNow } from "@/components/incident-parts";
import { ListItem } from "@/components/list-item";
import { useListEnd } from "@/components/list-end";
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
  const colors = useTheme();
  const { locale } = useLocale();
  const now = useNow(60_000);
  const [days, setDays] = useState(PAST_DAYS);
  // Fixed while the screen is open: a new `since` would ask the shard again.
  const [opened] = useState(() => Date.now());
  const { rows, status, error } = useQuery("incidents.past", { since: pastSince(days, opened) });
  const listEnd = useListEnd();
  return (
    <View style={{ flex: 1 }}>
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Text>{m.incidents_past_window({ days })}</Text>
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
            {status === "error" ? (
              // An instance from before the history (`unknown_query`), or a refusal: said, not an empty list.
              <EmptyRow
                title={m.incidents_past_title()}
                description={m.sync_refused_hint({ reason: queryErrorReason(error?.code) })}
                glyph={HISTORY_GLYPH}
              />
            ) : null}
            {rows.length === 0 && status === "ready" ? (
              <EmptyRow
                title={m.incidents_past_title()}
                description={m.incidents_past_empty({ days })}
                glyph={HISTORY_GLYPH}
              />
            ) : null}
          </FieldGroup.Section>
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
