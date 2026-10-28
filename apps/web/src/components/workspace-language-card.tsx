import { m } from "@freecorps/brigade-i18n";
import {
  WORKSPACE_LOCALES,
  workspaceLocale,
  type WorkspaceLocale,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useMember } from "@/components/session";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";

const text = (part: string) => m.workspace_language({ part });

const LANGUAGE_NAMES: Record<WorkspaceLocale, () => string> = {
  en: () => m.language_name_en(),
  "pt-BR": () => m.language_name_pt_br(),
};

/**
 * The language the workspace writes shared text in (RFC 0008 "Workspace locale", Q15): incidents its monitors and
 * alert sources open, Slack channel messages, AI postmortem drafts. Owners change it (`workspace.setLocale`); everyone
 * else reads it.
 */
export function WorkspaceLanguageCard() {
  const { role } = useMember();
  const workspace = useQuery("workspace.current", {});
  const setLocale = useMutation("workspace.setLocale");
  return (
    <WorkspaceLanguagePanel
      value={workspaceLocale(workspace.rows[0])}
      owner={role === "owner"}
      loading={workspace.status === "loading"}
      failed={workspace.status === "error"}
      onChange={async (locale) => {
        const outcome = await setLocale({ locale });
        // The same language again is nothing to save rather than a failure.
        return outcome.ok || outcome.error.code === "conflict";
      }}
    />
  );
}

/** The card without the hooks (tested with made-up data). */
export function WorkspaceLanguagePanel({
  value,
  owner,
  loading,
  failed,
  onChange,
}: {
  value: WorkspaceLocale;
  /** Only owners change it. */
  owner: boolean;
  loading: boolean;
  failed: boolean;
  onChange: (locale: WorkspaceLocale) => Promise<boolean>;
}) {
  const titleId = useId();
  const selectId = useId();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [picked, setPicked] = useState<WorkspaceLocale | null>(null);
  const shown = picked ?? value;
  // The synced row caught up: show it from here on.
  useEffect(() => {
    if (picked !== null && picked === value) setPicked(null);
  }, [picked, value]);
  const pick = (locale: WorkspaceLocale) => {
    setPicked(locale);
    setState("saving");
    void onChange(locale).then((ok) => {
      setState(ok ? "saved" : "failed");
      if (!ok) setPicked(null);
    });
  };
  return (
    <Card id="workspace-language" aria-labelledby={titleId}>
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id={titleId}>{text("title")}</CardTitle>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          {text("description")}
        </p>
      </div>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">{text("loading")}</p>
        ) : owner ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm font-medium">
              {text("label")}
            </label>
            <select
              id={selectId}
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:max-w-xs"
              value={shown}
              disabled={state === "saving"}
              onChange={(event) => pick(event.target.value as WorkspaceLocale)}
            >
              {WORKSPACE_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LANGUAGE_NAMES[locale]()}
                </option>
              ))}
            </select>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">{text("hint")}</p>
          </div>
        ) : (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            {m.workspace_language_read({ language: LANGUAGE_NAMES[value]() })}
          </p>
        )}
        {failed ? <FormError>{text("load_failed")}</FormError> : null}
        {state === "failed" ? <FormError>{text("failed")}</FormError> : null}
        {owner ? (
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
        ) : null}
      </CardContent>
    </Card>
  );
}
