import { FieldGroup, Row, Text } from "@expo/ui";
import { formatDateTime, formatRelativeTime, m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { spacing } from "@freecorps/brigade-ui";
import { router } from "expo-router";
import { useState } from "react";
import { FooterText } from "@/components/footer-text";
import { STATUS_GLYPHS } from "@/components/glyphs";
import { useListEnd } from "@/components/list-end";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { SeverityPill, StatusPill } from "@/components/pill";
import { RowChevron } from "@/components/row-chevron";
import { RowIcon } from "@/components/row-icon";
import { RowText } from "@/components/row-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";

/** Sample counts for the plural message: zero, one, few, and a count that needs a separator. */
const SAMPLE_COUNTS = [0, 1, 3, 1284];
const HOUR = 60 * 60 * 1000;

/**
 * The severity and status legend as the system's grouped list: each level and each status as the app marks it (the
 * pills of the incident list, the status's glyph), then how counts and dates read in this language.
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
            <ListItem key={severity}>
              <Row spacing={spacing[2]} alignment="center">
                <SeverityPill severity={severity} />
                <Text>{severityLabels[severity]()}</Text>
              </Row>
            </ListItem>
          ))}
        </FieldGroup.Section>

        <FieldGroup.Section title={m.legend_status()}>
          {INCIDENT_STATUSES.map((status) => (
            <ListItem
              key={status}
              leading={
                <RowIcon plain glyph={STATUS_GLYPHS[status]} color={colors.status[status].fg} />
              }
            >
              <Row alignment="center">
                <StatusPill status={status} />
              </Row>
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
