import { formatDateTime, formatRelativeTime, m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { radius, spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Badge } from "@/components/badge";
import { SEV1_GLYPH, STATUS_GLYPHS } from "@/components/glyphs";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";

/** Sample counts for the plural message: zero, one, few, and a count that needs a separator. */
const SAMPLE_COUNTS = [0, 1, 3, 1284];
const HOUR = 60 * 60 * 1000;

export function Overview() {
  const colors = useTheme();
  const system = useSystemColors();
  const padding = useScreenPadding();
  const { locale, timeZone } = useLocale();
  // A sample incident declared three hours before the screen opened.
  const [now] = useState(() => Date.now());
  const declared = now - 3 * HOUR;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: system.ground }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <ThemedText variant="caption">{m.mobile_overview_description()}</ThemedText>

      <Section title={m.legend_severity()}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }}>
          {SEVERITIES.map((severity) => (
            <Badge
              key={severity}
              colors={colors.severity[severity]}
              code={severity.toUpperCase()}
              icon={severity === "sev1" ? SEV1_GLYPH : undefined}
              label={severityLabels[severity]()}
            />
          ))}
        </View>
      </Section>

      <Section title={m.legend_status()}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }}>
          {INCIDENT_STATUSES.map((status) => (
            <Badge
              key={status}
              colors={colors.status[status]}
              icon={STATUS_GLYPHS[status]}
              label={incidentStatusLabels[status]()}
            />
          ))}
        </View>
      </Section>

      <Section title={m.legend_counts()} inset={false}>
        {SAMPLE_COUNTS.map((count, index) => (
          <Row key={count} first={index === 0}>
            <ThemedText style={{ fontVariant: ["tabular-nums"] }}>
              {m.incidents_active_count({ count })}
            </ThemedText>
          </Row>
        ))}
      </Section>

      <Section title={m.dates_title()} inset={false}>
        <Row first>
          <ThemedText variant="caption">{m.dates_absolute()}</ThemedText>
          <ThemedText selectable>{formatDateTime(declared, locale, timeZone)}</ThemedText>
        </Row>
        <Row>
          <ThemedText variant="caption">{m.dates_relative()}</ThemedText>
          <ThemedText selectable>{formatRelativeTime(declared, locale, now)}</ThemedText>
        </Row>
      </Section>

      {__DEV__ ? (
        <Link href="/intl" asChild>
          <Pressable accessibilityRole="link">
            {/* Styled inside: Link's `asChild` drops a style function on the Pressable. */}
            {({ pressed }) => (
              <View
                style={{
                  minHeight: spacing[12],
                  justifyContent: "center",
                  paddingHorizontal: spacing[4],
                  borderRadius: radius.xl,
                  borderCurve: "continuous",
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  // Colour-only press feedback, so reduced motion needs no special case.
                  backgroundColor: pressed ? colors.accent : colors.card,
                }}
              >
                <ThemedText style={{ color: colors.primary }}>{m.intl_open()}</ThemedText>
              </View>
            )}
          </Pressable>
        </Link>
      ) : null}
    </ScrollView>
  );
}
