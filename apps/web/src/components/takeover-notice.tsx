import { m } from "@freecorps/brigade-i18n";
import { ShieldCheckIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { dismissTakeover, fetchTakeover, type InheritedWorkspace } from "@/lib/takeover";

const text = (part: string) => m.takeover_notice({ part });

/**
 * Told once to the owner of an address who took back an account someone else signed up with (RFC 0002 "Auth"): the
 * workspaces that came with it and what Brigade paused there so that person cannot page them, until they dismiss it.
 * Nothing otherwise. `fetcher` is for the tests.
 */
export function TakeoverNotice({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const [workspaces, setWorkspaces] = useState<InheritedWorkspace[]>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTakeover(fetcher, controller.signal).then((found) => {
      if (!controller.signal.aborted) setWorkspaces(found);
    });
    return () => controller.abort();
  }, [fetcher]);
  if (!workspaces) return null;
  return (
    <TakeoverNoticeView
      workspaces={workspaces}
      dismiss={async () => {
        const done = await dismissTakeover(fetcher);
        if (done) setWorkspaces(undefined);
        return done;
      }}
    />
  );
}

export function TakeoverNoticeView({
  workspaces,
  dismiss,
}: {
  workspaces: InheritedWorkspace[];
  dismiss: () => Promise<boolean>;
}) {
  usePreferences();
  const titleId = useId();
  const [state, setState] = useState<"idle" | "dismissing" | "failed">("idle");
  return (
    <section
      aria-labelledby={titleId}
      className="@container rounded-md border border-amber-600/40 bg-card p-4"
    >
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:gap-4">
        <ShieldCheckIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="font-medium">
              {text("title")}
            </h2>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">{text("body")}</p>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {workspaces.map((workspace) => (
              <li key={workspace.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium [overflow-wrap:anywhere]">{workspace.name}</span>
                <span className="text-muted-foreground [overflow-wrap:anywhere]">
                  {summary(workspace)}
                </span>
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">{text("after")}</p>
          {state === "failed" ? (
            <p role="status" className="text-sm">
              {text("dismiss_failed")}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          disabled={state === "dismissing"}
          focusableWhenDisabled
          onClick={() => {
            setState("dismissing");
            void dismiss().then((done) => {
              if (!done) setState("failed");
            });
          }}
          className="self-start"
        >
          {state === "dismissing" ? text("dismissing") : text("dismiss")}
        </Button>
      </div>
    </section>
  );
}

/**
 * What was done in one workspace: the monitors paused (by name), the heartbeat and alert source URLs and the alert
 * routes turned off, the Slack connection disconnected, or nothing.
 */
function summary(workspace: InheritedWorkspace): string {
  if (workspace.failed) return text("failed");
  const sources = workspace.sources ?? 0;
  const routes = workspace.routes ?? 0;
  if (
    workspace.paused.length === 0 &&
    workspace.revoked === 0 &&
    sources === 0 &&
    routes === 0 &&
    workspace.slack === undefined
  ) {
    return text("nothing");
  }
  const parts: string[] = [];
  if (workspace.paused.length > 0) {
    parts.push(
      `${m.takeover_paused_count({ count: workspace.paused.length })}: ${workspace.paused.join(", ")}`,
    );
  }
  if (workspace.revoked > 0) parts.push(m.takeover_revoked_count({ count: workspace.revoked }));
  if (sources > 0) parts.push(m.takeover_sources_count({ count: sources }));
  if (routes > 0) parts.push(m.takeover_routes_count({ count: routes }));
  if (workspace.slack !== undefined) parts.push(m.takeover_slack({ team: workspace.slack }));
  return parts.join(". ");
}
