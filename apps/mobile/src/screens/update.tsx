import { formatNumber, m } from "@freecorps/brigade-i18n";
import { UPDATE_BODY_MAX } from "@freecorps/brigade-schema";
import {
  checkEdit,
  checkUpdate,
  UPDATE_COUNT_FROM,
  updateLength,
  type UpdateProblem,
} from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { UpdateForm } from "@/components/update-form";
import { useLocale } from "@/hooks/use-locale";
import { announceUpdate } from "@/lib/updates";

/**
 * Write an update to an incident's timeline, or edit one of the member's own (`entryId`), in the platform's own
 * form (`update-form.tsx`). Text the shard would refuse is caught here and stays; the sheet closes as soon as it
 * sends and the incident screen follows the outcome (`src/lib/updates.ts`).
 */
export function UpdateSheet({ number, entryId }: { number: number | null; entryId?: string }) {
  const { locale } = useLocale();
  const incident = useQuery("incident.byNumber", { number: number ?? 0 }).rows[0];
  const timeline = useQuery("incident.timeline", { id: incident?.id ?? "" });
  const entry = entryId
    ? timeline.rows.find((one) => one.id === entryId && one.kind === "update")
    : undefined;
  const original = entry?.kind === "update" ? entry.body : "";
  const postUpdate = useMutation("incident.postUpdate");
  const editUpdate = useMutation("incident.editUpdate");
  const [body, setBody] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<UpdateProblem | null>(null);
  const text = body ?? original;
  const length = updateLength(text);

  const submit = () => {
    if (!incident) return;
    const fail = (reason: UpdateProblem) => {
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      setInvalid(reason);
    };
    if (entryId) {
      if (text === original) return router.back();
      const checked = checkEdit(incident.id, entryId, text);
      if (!checked.ok) return fail(checked.reason);
      announceUpdate({
        kind: "edit",
        incidentId: incident.id,
        entryId,
        outcome: editUpdate(checked.args),
      });
    } else {
      const checked = checkUpdate(incident.id, text);
      if (!checked.ok) return fail(checked.reason);
      announceUpdate({
        kind: "post",
        incidentId: incident.id,
        body: checked.args.body,
        outcome: postUpdate({ id: incident.id, body: checked.args.body }),
      });
    }
    router.back();
  };

  // The sheet's title says whether it posts or edits, from the first render: loading and a removed update too.
  const title = entryId
    ? m.incident_update_change({ part: "edit_label", time: "", reason: "" })
    : m.incident_page({ part: "update_label" });
  const header = <Stack.Screen options={{ title }} />;

  // Nothing to write to until the incident is here, and an edit starts from the update's own text: until both have
  // loaded the sheet waits, rather than showing an empty field or dropping a tap on the button.
  const waiting = !incident || (entryId !== undefined && !entry);
  if (waiting) {
    const gone =
      number === null || (entryId !== undefined && incident && timeline.status === "ready");
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        {header}
        {gone ? (
          <ThemedText selectable>
            {entryId !== undefined && incident
              ? m.incident_update_change({ part: "gone", time: "", reason: "" })
              : m.incident_page({ part: "not_found" })}
          </ThemedText>
        ) : (
          <ActivityIndicator accessibilityLabel={m.incident_page({ part: "loading" })} />
        )}
      </View>
    );
  }

  return (
    <>
      {header}
      <UpdateForm
        key={entryId ?? "new"}
        title={title}
        initial={original}
        placeholder={m.incident_page({ part: "update_placeholder" })}
        note={
          length >= UPDATE_COUNT_FROM
            ? m.incident_update_length({
                count: formatNumber(length, locale),
                max: formatNumber(UPDATE_BODY_MAX, locale),
              })
            : entryId
              ? m.incident_update_change({ part: "status_page_note", time: "", reason: "" })
              : m.incident_page({ part: "update_hint" })
        }
        problem={
          invalid === null
            ? null
            : invalid === "long"
              ? m.auth_error_too_long({ max: formatNumber(UPDATE_BODY_MAX, locale) })
              : m.incident_page({ part: invalid === "empty" ? "update_empty" : "update_invalid" })
        }
        submit={
          entryId
            ? m.incident_update_change({ part: "save", time: "", reason: "" })
            : m.incident_page({ part: "post" })
        }
        onChange={(value) => {
          setBody(value);
          if (invalid) setInvalid(null);
        }}
        onSubmit={submit}
      />
    </>
  );
}
