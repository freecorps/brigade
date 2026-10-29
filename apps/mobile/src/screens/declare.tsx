import type { Severity } from "@freecorps/brigade-schema";
import { checkDeclare } from "@freecorps/brigade-sync";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { DeclareForm } from "@/components/declare-form";
import { announceDeclare } from "@/lib/declares";

/**
 * Declare an incident: a title, the incident type (which brings its usual severity), the severity and, when the
 * workspace has any, the escalation policy, in the platform's own form (`declare-form.tsx`). The sheet closes as soon
 * as it sends; the list follows the outcome (`src/lib/declares.ts`).
 */
export function Declare() {
  const client = useSyncClient();
  const declare = useMutation("incident.declare");
  const policies = useQuery("escalationPolicies.all", {}).rows;
  const types = useQuery("incidentTypes.all", {}).rows;

  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  // SEV3 each time the sheet opens, so a SEV1 chosen once cannot page people again by accident.
  const [severity, setSeverity] = useState<Severity>("sev3");
  /** A policy picked by hand (first in the order, RFC 0006 "Who is paged"); "" for the usual one. */
  const [policyId, setPolicyId] = useState("");
  const [invalid, setInvalid] = useState<"empty" | "invalid" | null>(null);

  const onDeclare = () => {
    const id = client.newId("inc");
    const checked = checkDeclare(id, title, severity);
    if (!checked.ok) {
      if (process.env.EXPO_OS === "ios") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return setInvalid(title.trim() === "" ? "empty" : "invalid");
    }
    // A type or policy deleted meanwhile is left out by the shard: the declare still goes through.
    const type = types.find((one) => one.id === typeId);
    const policy = policies.find((one) => one.id === policyId);
    const args = {
      ...checked.args,
      ...(type && { typeId: type.id }),
      ...(policy && { escalationPolicyId: policy.id }),
    };
    if (process.env.EXPO_OS === "ios") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    announceDeclare({ incidentId: id, title: args.title, outcome: declare(args) });
    router.back();
  };

  return (
    <DeclareForm
      severity={severity}
      onSeverity={setSeverity}
      typeId={typeId}
      onType={(value) => {
        setTypeId(value);
        // A type brings its usual severity; no type, the default.
        setSeverity(types.find((one) => one.id === value)?.defaultSeverity ?? "sev3");
      }}
      types={types}
      policyId={policyId}
      onPolicy={setPolicyId}
      policies={policies}
      invalid={invalid}
      onTitle={(text) => {
        setTitle(text);
        if (invalid) setInvalid(null);
      }}
      onDeclare={onDeclare}
    />
  );
}
