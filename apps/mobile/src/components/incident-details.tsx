import { m } from "@freecorps/brigade-i18n";
import { fieldText } from "@freecorps/brigade-i18n/incident";
import {
  liveValue,
  missingFields,
  type CustomFieldRow,
  type FieldValue,
  type IncidentRow,
} from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";

const text = (part: Parameters<typeof m.catalog_text>[0]["text"]) =>
  m.catalog_text({ text: part, name: "", reason: "" });

/** A field's value as it reads, or null when it holds nothing (or only options taken out). */
function valueText(field: CustomFieldRow, value: FieldValue | undefined): string | null {
  const live = liveValue(field, value);
  if (live === null) return null;
  if (field.kind !== "single_select" && field.kind !== "multi_select") return fieldText(live);
  const ids = Array.isArray(live) ? live : [live];
  return fieldText(
    null,
    ids.map((id) => field.options.find((option) => option.id === id)?.label ?? ""),
  );
}

/**
 * The incident's type, affected services and custom fields (RFC 0003), read-only: the dashboard edits them. Hidden
 * while the workspace has no catalog and the incident names nothing from one.
 */
export function IncidentDetails({ row }: { row: IncidentRow }) {
  const types = useQuery("incidentTypes.all", {}).rows;
  const services = useQuery("services.all", {}).rows;
  const fields = useQuery("customFields.all", {}).rows;
  const typeId = row.typeId ?? null;
  const named = (row.serviceIds ?? []).flatMap((id) => {
    const service = services.find((one) => one.id === id);
    return service ? [service.name] : [];
  });
  if (types.length + services.length + fields.length === 0 && typeId === null && !named.length) {
    return null;
  }
  const type = typeId ? types.find((one) => one.id === typeId) : undefined;
  const missing = new Set(missingFields(row, types, fields).map((field) => field.id));
  const rows: { label: string; value: string; empty: boolean }[] = [
    {
      label: text("type_label"),
      value: typeId === null ? text("no_type") : (type?.name ?? text("deleted_type")),
      empty: typeId === null,
    },
    {
      label: text("services_label"),
      value: named.length ? named.join(", ") : text("no_services"),
      empty: named.length === 0,
    },
    ...fields.map((field) => {
      const value = valueText(field, row.fields?.[field.id]);
      return {
        label: field.name,
        value: value ?? (missing.has(field.id) ? text("required") : text("not_set")),
        empty: value === null,
      };
    }),
  ];
  return (
    <Section title={text("details_title")} inset={false}>
      {rows.map((one, index) => (
        <Row key={`${index}:${one.label}`} first={index === 0}>
          <ThemedText variant="label">{one.label}</ThemedText>
          <ThemedText variant={one.empty ? "caption" : "body"} selectable>
            {one.value}
          </ThemedText>
        </Row>
      ))}
    </Section>
  );
}
