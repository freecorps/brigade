import {
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  m,
  type Locale,
} from "@freecorps/brigade-i18n";
import { fontFamily, fontSize, spacing } from "@freecorps/brigade-ui";
import { useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { Badge } from "@/components/badge";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { nativeIntl } from "@/intl/native";
import { INTL_FEATURES, type IntlFeature } from "@/intl/probe";
import { currentIntl } from "@/intl/setup";

// Feature names are API names, not prose: they stay untranslated, like SEV codes.
const FEATURE_NAMES: Record<IntlFeature, string> = {
  pluralRules: "Intl.PluralRules",
  relativeTimeFormat: "Intl.RelativeTimeFormat",
  dateTimeStyle: "DateTimeFormat dateStyle/timeStyle",
  timeZone: "DateTimeFormat timeZone",
  numberFormat: "Intl.NumberFormat",
  locale: "Intl.Locale",
};

const LOCALES: readonly Locale[] = ["en", "pt-BR"];
const SAMPLE_COUNTS = [0, 1, 3, 1284];
const HOUR = 60 * 60 * 1000;

interface HermesInternal {
  getRuntimeProperties?: () => Record<string, string | undefined>;
}

function engineName(): string {
  const hermes = (globalThis as { HermesInternal?: HermesInternal }).HermesInternal;
  if (!hermes) return m.intl_engine_other();
  const version = hermes.getRuntimeProperties?.()["OSS Release Version"];
  return version ? `Hermes ${version}` : "Hermes";
}

export function IntlDiagnostics() {
  const colors = useTheme();
  const padding = useScreenPadding();
  const { timeZone } = useLocale();
  const [now] = useState(() => Date.now());
  const mono = {
    fontFamily: Platform.select(fontFamily.native.mono),
    fontSize: fontSize.xs.size,
    lineHeight: fontSize.xs.lineHeight,
    color: colors.mutedForeground,
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <View style={{ gap: spacing[1] }}>
        <ThemedText variant="caption">{m.intl_description()}</ThemedText>
        <ThemedText variant="caption" selectable>
          {m.intl_engine({
            engine: `${engineName()} · ${Platform.OS} ${String(Platform.Version)}`,
          })}
        </ThemedText>
      </View>

      <Section title={m.intl_feature()} inset={false}>
        {INTL_FEATURES.map((feature, index) => {
          const native = nativeIntl[feature];
          const current = currentIntl[feature];
          const badge = native.works
            ? { colors: colors.status.resolved, label: m.intl_native() }
            : current.works
              ? { colors: colors.status.monitoring, label: m.intl_polyfilled() }
              : { colors: colors.severity.sev2, label: m.intl_missing() };
          return (
            <Row key={feature} first={index === 0}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: spacing[2],
                }}
              >
                <ThemedText style={{ flexShrink: 1 }}>{FEATURE_NAMES[feature]}</ThemedText>
                <Badge {...badge} />
              </View>
              <Text selectable style={mono}>
                {native.works || native.detail === current.detail
                  ? native.detail
                  : `${native.detail} → ${current.detail}`}
              </Text>
            </Row>
          );
        })}
      </Section>

      {LOCALES.map((locale) => (
        <Section key={locale} title={`${m.intl_rendered()} · ${locale}`} inset={false}>
          {SAMPLE_COUNTS.map((count, index) => (
            <Row key={count} first={index === 0}>
              <ThemedText selectable>{m.incidents_active_count({ count }, { locale })}</ThemedText>
            </Row>
          ))}
          <Row>
            <ThemedText selectable>{formatDateTime(now, locale, timeZone)}</ThemedText>
          </Row>
          <Row>
            <ThemedText selectable>{formatRelativeTime(now - 3 * HOUR, locale, now)}</ThemedText>
          </Row>
          <Row>
            <ThemedText selectable>{formatRelativeTime(now - 26 * HOUR, locale, now)}</ThemedText>
          </Row>
          <Row>
            <ThemedText selectable>{formatNumber(1284.5, locale)}</ThemedText>
          </Row>
        </Section>
      ))}
    </ScrollView>
  );
}
