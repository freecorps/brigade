import { FieldGroup, Text } from "@expo/ui";
import { formatDateTime, formatRelativeTime, m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { router } from "expo-router";
import { useState } from "react";
import { FooterText } from "@/components/footer-text";
import { LegendMark } from "@/components/legend-mark";
import { useListEnd } from "@/components/list-end";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { RowChevron } from "@/components/row-chevron";
import { RowText } from "@/components/row-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";

/** Sample counts for the plural message: zero, one, few, and a count that needs a separator. */
const SAMPLE_COUNTS = [0, 1, 3, 1284];
const HOUR = 60 * 60 * 1000;

/**
 * The severity and status legend as the system's grouped list. Every level and every status reads the same way: its
 * mark as the app draws it (the severity's code, the status's glyph, in its colours), then its name. Then how counts
 * and dates read in this language.
 */
export function Overview() {
  const colors = useTheme();
  const listEnd = useListEnd();
  const { locale, timeZone } = useLocale();
  // A sample incident declared three hours before the screen opened.
  const [now] = useState(() => Date.now());
  const declared = now - 3 * HOUR;

  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section title={m.legend_severity()}>
          {SEVERITIES.map((severity) => (
            <ListItem key={severity} leading={<LegendMark severity={severity} />}>
              <Text>{severityLabels[severity]()}</Text>
            </ListItem>
          ))}
        </FieldGroup.Section>

        <FieldGroup.Section title={m.legend_status()}>
          {INCIDENT_STATUSES.map((status) => (
            <ListItem key={status} leading={<LegendMark status={status} />}>
              <Text>{incidentStatusLabels[status]()}</Text>
            </ListItem>
          ))}
          <FieldGroup.SectionFooter>
            <FooterText>{m.legend_description()}</FooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>

        <FieldGroup.Section title={m.legend_counts()}>
          {SAMPLE_COUNTS.map((count) => (
            <ListItem key={count}>
              <Text>{m.incidents_active_count({ count })}</Text>
            </ListItem>
          ))}
        </FieldGroup.Section>

        <FieldGroup.Section title={m.dates_title()}>
          <ListItem
            trailing={
              <RowText color={colors.mutedForeground}>
                {formatDateTime(declared, locale, timeZone)}
              </RowText>
            }
          >
            <Text>{m.dates_absolute()}</Text>
          </ListItem>
          <ListItem
            trailing={
              <RowText color={colors.mutedForeground}>
                {formatRelativeTime(declared, locale, now)}
              </RowText>
            }
          >
            <Text>{m.dates_relative()}</Text>
          </ListItem>
        </FieldGroup.Section>

        {__DEV__ ? (
          <FieldGroup.Section>
            <ListItem onPress={() => router.push("/intl")} trailing={<RowChevron />}>
              <Text>{m.intl_open()}</Text>
            </ListItem>
          </FieldGroup.Section>
        ) : null}
        {listEnd}
      </FieldGroup>
    </NativeHost>
  );
}
