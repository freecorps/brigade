import { m } from "@freecorps/brigade-i18n";
import { ExternalLinkIcon } from "lucide-react";
import { usePagingHealth } from "@/components/paging-health";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PagingHealth } from "@/lib/paging-health";
import { appAdvice } from "@/lib/relay";

const text = (part: string) => m.use_app({ part });

/**
 * "Use the app" on the member's account page (RFC 0015 section 8): which app to install for this instance. The Brigade
 * app from the stores on Freecorps' relay; the company's own build, with its link, on an own relay (the store app can
 * never be paged by it); and nothing about pages when no relay is set up. `fetcher` is for the tests.
 */
export function UseAppCard({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  return <UseAppPanel health={usePagingHealth(fetcher)} />;
}

/** The card without the hooks (tested with made-up answers). */
export function UseAppPanel({ health }: { health: PagingHealth | "unreachable" | undefined }) {
  const advice = appAdvice(health);
  return (
    <Card id="use-the-app" aria-labelledby="use-app-title">
      <CardHeader id="use-app-title" title={text("title")} description={text("description")} />
      <CardContent className="flex flex-col items-start gap-3">
        {/* One sentence that changes in place, the only live part: when the check lands, a screen reader hears which
            app to install, not the whole card again. */}
        <p
          aria-live="polite"
          className={
            advice.kind === "checking" || advice.kind === "unknown"
              ? "text-muted-foreground"
              : "max-w-prose"
          }
        >
          {advice.kind === "checking"
            ? text("checking")
            : advice.kind === "unknown"
              ? text("failed")
              : text(advice.kind)}
        </p>
        {advice.kind !== "own" ? null : advice.app ? (
          <a
            href={advice.app}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({ variant: "outline", className: "max-w-full" })}
          >
            <ExternalLinkIcon aria-hidden />
            <span className="truncate">{text("own_link")}</span>
          </a>
        ) : (
          <p className="max-w-prose text-muted-foreground">{text("own_no_link")}</p>
        )}
      </CardContent>
    </Card>
  );
}
