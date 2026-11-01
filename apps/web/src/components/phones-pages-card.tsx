import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { can } from "@freecorps/brigade-schema";
import { cn } from "cn";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { usePagingHealth } from "@/components/paging-health";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PagingAnswer } from "@/lib/paging-health";
import {
  relayState,
  SETUP_RELAY,
  stateView,
  type HintKey,
  type LabelKey,
  type RelayTone,
} from "@/lib/relay";

type Part = "title" | "description" | LabelKey | HintKey | (string & {});
const text = (part: Part, host = "") => m.phones_pages({ part, host });

/**
 * "Phones and pages" in the workspace settings (RFC 0015 section 8): which relay pages go through, its state from the
 * watchdog's deep check with what to do about it, and an own relay's app link. Owners and admins only: the fixes are
 * for whoever runs the instance; everyone else learns which app to install from "Use the app" on their account page.
 * `fetcher` is for the tests.
 */
export function PhonesPagesCard({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const { role } = useMember();
  if (!can(role, "workspace:manage")) return null;
  return <PhonesPages fetcher={fetcher} />;
}

function PhonesPages({ fetcher }: { fetcher: typeof fetch }) {
  const health = usePagingHealth(fetcher);
  const { locale } = usePreferences();
  return <PhonesPagesPanel health={health} locale={locale} />;
}

const TONES: Record<RelayTone, { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheckIcon, className: "text-primary" },
  neutral: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  warning: { icon: TriangleAlertIcon, className: "text-amber-700 dark:text-amber-400" },
  error: { icon: CircleAlertIcon, className: "text-destructive" },
};

/** The card without the hooks (tested with made-up answers). `health` undefined: the first check is on its way. */
export function PhonesPagesPanel({
  health,
  locale,
}: {
  health: PagingAnswer | undefined;
  locale: Locale;
}) {
  // A 503 (the watchdog down) still says which relay; only the state is unknown then.
  const relay = health === undefined ? null : health.relay;
  const state = relayState(health);
  // With no relay there is no relay state to show, but Brigade's own trouble (beats stopped, the database, the
  // watchdog not answering) still is: the settings page has no other place for it. A bare `relay_not_configured` is
  // the "no relay" line itself.
  const showState =
    relay?.kind !== "none" || state === "pipeline" || state === "database" || state === "no_answer";
  return (
    <Card id="phones-and-pages" aria-labelledby="phones-pages-title">
      <CardHeader id="phones-pages-title" title={text("title")} description={text("description")} />
      <CardContent>
        <dl
          aria-busy={health === undefined}
          className="flex flex-col gap-5 sm:grid sm:grid-cols-[minmax(7rem,auto)_1fr] sm:gap-x-6"
        >
          <Row label={text("relay_label")}>
            {health === undefined ? (
              <Placeholder className="h-5 w-64" />
            ) : relay === null ? (
              // The API could not say which relay (no answer, or an older API): the state row says why.
              <Hint>{text("relay_unknown")}</Hint>
            ) : relay.kind === "none" ? (
              <>
                <Status tone="warning" label={text("relay_none")} />
                <Hint>{text("none_hint")}</Hint>
                <Command>{SETUP_RELAY}</Command>
              </>
            ) : (
              <>
                <p className="font-medium [overflow-wrap:anywhere]">
                  {relay.kind === "freecorps"
                    ? text("relay_freecorps")
                    : relay.host
                      ? text("relay_own_host", relay.host)
                      : text("relay_own")}
                </p>
                <Hint>{text(relay.kind === "freecorps" ? "freecorps_hint" : "own_hint")}</Hint>
              </>
            )}
          </Row>

          {!showState ? null : (
            <Row label={text("state_label")}>
              {state === undefined ? (
                <Placeholder className="h-5 w-32" />
              ) : (
                <StateDetails
                  health={health}
                  view={stateView(
                    state,
                    relay === null || relay.kind === "none" ? null : relay.kind,
                  )}
                  locale={locale}
                />
              )}
            </Row>
          )}

          {relay?.kind === "own" ? (
            <Row label={text("app_label")}>
              {relay.app ? (
                <a
                  href={relay.app}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-6 max-w-full items-start gap-1.5 font-medium text-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2"
                >
                  <ExternalLinkIcon aria-hidden className="mt-1 size-3.5 shrink-0" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{relay.app}</span>
                </a>
              ) : (
                <>
                  <Hint>{text("app_none")}</Hint>
                  <Command>{SETUP_RELAY}</Command>
                </>
              )}
            </Row>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function StateDetails({
  health,
  view,
  locale,
}: {
  health: PagingAnswer | undefined;
  view: ReturnType<typeof stateView>;
  locale: Locale;
}) {
  const lastOkAt = health && health.status !== "unreachable" ? health.lastOkAt : null;
  return (
    <>
      <Status tone={view.tone} label={text(view.label)} />
      <Hint>{text(view.hint)}</Hint>
      {view.command ? <Command>{view.command}</Command> : null}
      {lastOkAt && view.state !== "not_checked" ? (
        <p className="text-muted-foreground tabular-nums">
          {m.paging_last_ok({
            // With the date: a relay refusing since yesterday must not read like a minute ago.
            time: formatDateTime(
              lastOkAt,
              locale,
              Intl.DateTimeFormat().resolvedOptions().timeZone,
              {
                dateStyle: "medium",
                timeStyle: "short",
              },
            ),
          })}
        </p>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    // A label over its value on a phone; on wider screens, labels in one column and values in the next.
    <div className="flex flex-col gap-1 sm:col-span-2 sm:grid sm:grid-cols-subgrid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col items-start gap-1.5">{children}</dd>
    </div>
  );
}

function Status({ tone, label }: { tone: RelayTone; label: string }) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <p className="flex items-start gap-2 font-medium">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
    </p>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-muted-foreground">{children}</p>;
}

/**
 * A command to run where the instance is deployed from: selectable as a whole, and on a narrow phone it wraps only
 * between words, never inside a flag (`--instance-key-file` split at its hyphens reads as two flags).
 */
function Command({ children }: { children: string }) {
  const words = children.split(" ");
  return (
    <code className="max-w-full rounded-sm bg-muted px-2 py-1 font-mono text-[0.8125rem] text-foreground select-all">
      {words.map((word, index) => (
        // The space sits outside the unbreakable word, so the line may break there.
        <Fragment key={index}>
          {index > 0 ? " " : null}
          <span className="whitespace-nowrap">{word}</span>
        </Fragment>
      ))}
    </code>
  );
}

/** A flat bar at the size of the value it stands for, so nothing moves when the answer lands. */
function Placeholder({ className }: { className: string }) {
  return <span aria-hidden className={cn("block max-w-full rounded-sm bg-muted", className)} />;
}
