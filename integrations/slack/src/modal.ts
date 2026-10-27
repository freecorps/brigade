// The `/inc declare` form (RFC 0011 "Commands"): a modal with the title, the severity, the incident type and the
// affected services. The API opens it with `views.open` (it holds the token and reads the workspace's types and
// services); this Worker reads the submission (`view_submission`) and declares through the bridge.

import { slack_text } from "@freecorps/brigade-i18n/messages";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  INCIDENT_TITLE_MAX,
  isId,
  MAX_INCIDENT_SERVICES,
  SEVERITIES,
  type Severity,
  type SlackLocale,
} from "@freecorps/brigade-schema";
import { NO_ARGS } from "./notifier.ts";

/** The form's `callback_id`: its submission is a declaration. */
export const DECLARE_CALLBACK = "brigade_declare";
/** Slack's limits: options in a select, characters in an option's text. */
const MAX_OPTIONS = 100;
const OPTION_TEXT_MAX = 75;

/** What the form carries through Slack, signed with the submission: where to answer. */
export type DeclareMetadata = { responseUrl: string };

export type DeclareChoice = { id: string; name: string };

const option = (value: string, text: string) => ({
  text: {
    type: "plain_text",
    // Plain text, so names need no escaping; Slack refuses an option text past 75 characters.
    text: text.length > OPTION_TEXT_MAX ? `${text.slice(0, OPTION_TEXT_MAX - 1)}…` : text,
    emoji: false,
  },
  value,
});

/** The modal `views.open` takes, in `locale`, starting at `severity`. */
export function declareModal(options: {
  locale: SlackLocale;
  severity: Severity;
  types: DeclareChoice[];
  services: DeclareChoice[];
  metadata: DeclareMetadata;
}): Record<string, unknown> {
  const { locale } = options;
  const say = (part: string) => slack_text({ ...NO_ARGS, part }, { locale });
  const plain = (text: string) => ({ type: "plain_text", text, emoji: false });
  const severities = SEVERITIES.map((severity) =>
    option(severity, `${severity.toUpperCase()} · ${severityLabels[severity]({}, { locale })}`),
  );
  const blocks: Record<string, unknown>[] = [
    {
      type: "input",
      block_id: "title",
      label: plain(say("modal_title_label")),
      element: {
        type: "plain_text_input",
        action_id: "value",
        max_length: INCIDENT_TITLE_MAX,
        placeholder: plain(say("modal_title_placeholder")),
      },
    },
    {
      type: "input",
      block_id: "severity",
      label: plain(say("modal_severity_label")),
      element: {
        type: "static_select",
        action_id: "value",
        options: severities,
        initial_option: severities[SEVERITIES.indexOf(options.severity)],
      },
    },
  ];
  const types = options.types.slice(0, MAX_OPTIONS);
  if (types.length > 0) {
    blocks.push({
      type: "input",
      block_id: "type",
      optional: true,
      label: plain(say("modal_type_label")),
      element: {
        type: "static_select",
        action_id: "value",
        placeholder: plain(say("modal_type_placeholder")),
        options: types.map((type) => option(type.id, type.name)),
      },
    });
  }
  const services = options.services.slice(0, MAX_OPTIONS);
  if (services.length > 0) {
    blocks.push({
      type: "input",
      block_id: "services",
      optional: true,
      label: plain(say("modal_services_label")),
      element: {
        type: "multi_static_select",
        action_id: "value",
        placeholder: plain(say("modal_services_placeholder")),
        max_selected_items: MAX_INCIDENT_SERVICES,
        options: services.map((service) => option(service.id, service.name)),
      },
    });
  }
  return {
    type: "modal",
    callback_id: DECLARE_CALLBACK,
    title: plain(say("modal_title")),
    submit: plain(say("modal_submit")),
    close: plain(say("modal_close")),
    private_metadata: JSON.stringify(options.metadata),
    blocks,
  };
}

export type DeclareSubmission = {
  title: string;
  severity: Severity;
  typeId?: string;
  serviceIds?: string[];
  metadata: DeclareMetadata | null;
};

/**
 * What a submitted form asks for, read from Slack's `view` (signed with the request); undefined when it is not this
 * form or has no title. Ids that are not a type's or a service's are dropped: the shard checks the rest.
 */
export function readDeclareSubmission(view: unknown): DeclareSubmission | undefined {
  const record = Object(view) as Record<string, unknown>;
  if (record.callback_id !== DECLARE_CALLBACK) return undefined;
  const values = Object(Object(record.state).values) as Record<string, Record<string, unknown>>;
  const field = (block: string) => Object(Object(values[block]).value) as Record<string, unknown>;
  const title = typeof field("title").value === "string" ? String(field("title").value).trim() : "";
  const severity = SEVERITIES.find(
    (value) => value === Object(field("severity").selected_option).value,
  );
  if (!title || !severity) return undefined;
  const typeId = Object(field("type").selected_option).value;
  const picked = field("services").selected_options;
  const serviceIds = (Array.isArray(picked) ? picked : [])
    .map((one: unknown) => Object(one).value)
    .filter((id: unknown): id is string => isId("svc", id))
    .slice(0, MAX_INCIDENT_SERVICES);
  let metadata: DeclareMetadata | null = null;
  try {
    const parsed = JSON.parse(
      typeof record.private_metadata === "string" ? record.private_metadata : "",
    ) as Record<string, unknown>;
    if (typeof parsed.responseUrl === "string") metadata = { responseUrl: parsed.responseUrl };
  } catch {
    metadata = null;
  }
  return {
    title,
    severity,
    ...(isId("typ", typeId) ? { typeId } : {}),
    ...(serviceIds.length > 0 ? { serviceIds } : {}),
    metadata,
  };
}
