import { m } from "@freecorps/brigade-i18n";
import {
  can,
  emailSettings,
  memberEmailOf,
  type EmailSettings,
  type MemberEmail,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useMember } from "@/components/session";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";

const memberText = (part: string) => m.member_email_settings({ part });
const workspaceText = (part: string) => m.workspace_email_settings({ part });

/** The outcome of a save: the same values again is a `conflict`, which is nothing to save rather than a failure. */
const saved = (outcome: { ok: true } | { ok: false; error: { code: string } }) =>
  outcome.ok || outcome.error.code === "conflict";

/**
 * The signed-in member's own email choices in the workspace (RFC 0005 "Email", RFC 0013 "Reminders"), saved as soon as
 * one is switched (`member.setEmail`). The owners' "a page reached nobody" email is not here: the card says it always
 * goes to owners, as the fallback when paging fails.
 */
export function EmailCard() {
  const { userId } = useMember();
  const settings = useQuery("members.settings", {});
  const workspace = useQuery("workspace.current", {});
  const setEmail = useMutation("member.setEmail");
  return (
    <EmailPanel
      value={memberEmailOf(settings.rows, userId)}
      workspaceUnpaged={emailSettings(workspace.rows[0]).unpaged}
      loading={settings.status === "loading"}
      failed={settings.status === "error"}
      onChange={async (next) => saved(await setEmail(next))}
    />
  );
}

/** The member's card without the hooks (tested with made-up data). */
export function EmailPanel({
  value,
  workspaceUnpaged,
  loading,
  failed,
  onChange,
}: {
  value: MemberEmail;
  /** Whether the workspace sends missed-page emails at all (`workspace.setEmail`). */
  workspaceUnpaged: boolean;
  loading: boolean;
  failed: boolean;
  onChange: (next: MemberEmail) => Promise<boolean>;
}) {
  return (
    <TogglePanel
      text={memberText}
      value={value}
      loading={loading}
      failed={failed}
      onChange={onChange}
      toggles={[
        {
          key: "missedPages",
          label: memberText("missed"),
          hint: memberText("missed_hint"),
          ...(workspaceUnpaged ? {} : { note: memberText("missed_workspace_off") }),
        },
        {
          key: "followUpReminders",
          label: memberText("reminders"),
          hint: memberText("reminders_hint"),
        },
      ]}
      footnote={memberText("owners_note")}
    />
  );
}

/**
 * Who the workspace emails when paging fails (`workspace.setEmail`, RFC 0005 "Email"): owners and admins only, so the
 * card is not shown to anyone else.
 */
export function WorkspaceEmailCard() {
  const { role } = useMember();
  if (!can(role, "workspace:manage")) return null;
  return <WorkspaceEmailSettings />;
}

function WorkspaceEmailSettings() {
  const workspace = useQuery("workspace.current", {});
  const setEmail = useMutation("workspace.setEmail");
  return (
    <WorkspaceEmailPanel
      value={emailSettings(workspace.rows[0])}
      loading={workspace.status === "loading"}
      failed={workspace.status === "error"}
      onChange={async (next) => saved(await setEmail(next))}
    />
  );
}

/** The workspace's card without the hooks (tested with made-up data). */
export function WorkspaceEmailPanel({
  value,
  loading,
  failed,
  onChange,
}: {
  value: EmailSettings;
  loading: boolean;
  failed: boolean;
  onChange: (next: EmailSettings) => Promise<boolean>;
}) {
  return (
    <TogglePanel
      text={workspaceText}
      value={value}
      loading={loading}
      failed={failed}
      onChange={onChange}
      toggles={[
        { key: "unpaged", label: workspaceText("unpaged"), hint: workspaceText("unpaged_hint") },
        {
          key: "nobodyPaged",
          label: workspaceText("nobody"),
          hint: workspaceText("nobody_hint"),
          offWarning: workspaceText("nobody_off"),
        },
      ]}
    />
  );
}

type Toggle<K extends string> = {
  key: K;
  label: string;
  hint: string;
  /** Shown under the hint, whatever the value (context from elsewhere). */
  note?: string;
  /** Shown under the hint while it is off. */
  offWarning?: string;
};

/**
 * A card of on/off settings saved as soon as one is switched, all sent together. What was just switched shows until the
 * synced row agrees, or the save fails and it goes back.
 */
function TogglePanel<K extends string>({
  text,
  value,
  toggles,
  footnote,
  loading,
  failed,
  onChange,
}: {
  /** The card's messages: `title`, `description`, `loading`, `load_failed`, `saving`, `saved`, `failed`. */
  text: (part: string) => string;
  value: Record<K, boolean>;
  toggles: Toggle<K>[];
  footnote?: string;
  loading: boolean;
  failed: boolean;
  onChange: (next: Record<K, boolean>) => Promise<boolean>;
}) {
  const titleId = useId();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [picked, setPicked] = useState<Record<K, boolean> | null>(null);
  const shown = picked ?? value;
  // The synced row caught up: show it from here on.
  useEffect(() => {
    if (
      picked !== null &&
      (Object.keys(picked) as K[]).every((key) => picked[key] === value[key])
    ) {
      setPicked(null);
    }
  }, [picked, value]);
  const flip = (key: K, on: boolean) => {
    const next = { ...shown, [key]: on };
    setPicked(next);
    setState("saving");
    void onChange(next).then((ok) => {
      setState(ok ? "saved" : "failed");
      if (!ok) setPicked(null);
    });
  };
  return (
    <Card aria-labelledby={titleId}>
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id={titleId}>{text("title")}</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">{text("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">{text("loading")}</p>
        ) : (
          <fieldset
            className="flex min-w-0 flex-col gap-2"
            disabled={state === "saving"}
            aria-labelledby={titleId}
          >
            {toggles.map((toggle) => {
              const on = shown[toggle.key];
              return (
                <label
                  key={toggle.key}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
                    "has-focus-visible:ring-3 has-focus-visible:ring-ring",
                    on ? "border-primary bg-primary/5" : "border-input hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    role="switch"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={on}
                    onChange={(event) => flip(toggle.key, event.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
                    <span className="font-medium">{toggle.label}</span>
                    <span className="text-muted-foreground">{toggle.hint}</span>
                    {toggle.note ? (
                      <span className="text-muted-foreground">{toggle.note}</span>
                    ) : null}
                    {toggle.offWarning && !on ? (
                      <span className="text-destructive">{toggle.offWarning}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {footnote ? <p className="max-w-prose text-sm text-muted-foreground">{footnote}</p> : null}
        {failed ? <FormError>{text("load_failed")}</FormError> : null}
        {state === "failed" ? <FormError>{text("failed")}</FormError> : null}
        <p
          role="status"
          className="flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground"
        >
          {state === "saving" ? (
            <>
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
              {text("saving")}
            </>
          ) : state === "saved" ? (
            text("saved")
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Keeps the time zone the member's reminders follow (`member.setTimeZone`, RFC 0013 "Reminders") on this browser's,
 * once the settings are read and only when they differ. Renders nothing; a failure is left for the next visit.
 */
export function TimeZoneSync() {
  const { userId } = useMember();
  const settings = useQuery("members.settings", {});
  const setTimeZone = useMutation("member.setTimeZone");
  const kept = settings.rows.find((row) => row.id === userId)?.timeZone;
  const ready = settings.status === "ready";
  useEffect(() => {
    const zone = deviceTimeZone();
    if (!ready || zone === undefined || zone === kept) return;
    void setTimeZone({ timeZone: zone });
  }, [ready, kept, setTimeZone]);
  return null;
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
