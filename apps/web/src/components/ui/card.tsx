import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "cn";

// Brigade's one card. Every card on every page is built from these parts, so a header, a list or a section looks
// and lines up the same wherever it is:
//
//   <Card aria-labelledby="x-title">
//     <CardHeader id="x-title" title="…" count="3 schedules" description="…" action={<Button />} />
//     <CardContent>…</CardContent>            padded content
//     <CardList>…</CardList>                  rows that run to the card's edges (each row pads itself: CARD_ROW)
//     <CardContent><CardSection …>…</CardSection></CardContent>   a titled part inside a card
//   </Card>
//
// A flat card on the page ground, separated by one token border (no shadow), with the tight radius used across the
// dashboard. A card that ends in a CardList drops its bottom padding (the list's last row brings its own).

function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-6 overflow-hidden rounded-lg border bg-card py-5 text-sm text-card-foreground sm:py-6",
        "has-[>[data-slot=card-list]:last-child]:pb-0",
        className,
      )}
      {...props}
    />
  );
}

/** The horizontal padding every part of a card shares, so text in a header, a section and a row starts on one edge. */
const CARD_X = "px-4 sm:px-6";

/** A row of a CardList: the card's edge padding and the one row rhythm. */
const CARD_ROW = cn(CARD_X, "py-3.5");

/**
 * The one card header. The title row is as tall as a button (44px on touch, 36px under a fine pointer) whether or not
 * it holds an action, so every description starts at the same height; the action sits at the row's right and wraps
 * under the title only when the row is too narrow for both. `count` is a grey figure after the title ("3
 * schedules"), `icon` a 16px grey glyph before it, `children` any further lines under the description (a status, a
 * notice), in the header's rhythm.
 */
function CardHeader({
  id,
  title,
  icon: Icon,
  count,
  description,
  action,
  as: Heading = "h2",
  className,
  titleProps,
  children,
}: {
  id: string;
  title: React.ReactNode;
  icon?: LucideIcon;
  count?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
  /** Extra props for the heading (a `tabIndex` so focus can land on it). */
  titleProps?: Omit<React.ComponentProps<"h2">, "id">;
  children?: React.ReactNode;
}) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1", CARD_X, className)}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 pointer-fine:min-h-9">
        {/* The count sits beside the heading, not in it, so the heading's name stays the title alone. */}
        <div className="flex min-w-0 items-baseline gap-2">
          {Icon ? (
            <Icon aria-hidden className="size-4 shrink-0 self-center text-muted-foreground" />
          ) : null}
          <Heading
            {...titleProps}
            id={id}
            className={cn(
              "min-w-0 text-base font-semibold text-card-foreground outline-none [overflow-wrap:anywhere]",
              titleProps?.className,
            )}
          >
            {title}
          </Heading>
          {count !== undefined && count !== null ? (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{count}</span>
          ) : null}
        </div>
        {action ? (
          <div data-slot="card-action" className="flex shrink-0 flex-wrap items-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
      {description ? (
        <p data-slot="card-description" className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * A titled part inside a card (Routes under Alert sources, Roles under incident settings): the CardHeader's layout one
 * step down, an h3 at 14px, with its body under it. Sections in one card are split by space, not rules.
 */
function CardSection({
  id,
  title,
  count,
  description,
  action,
  className,
  children,
}: {
  id: string;
  title: React.ReactNode;
  count?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-slot="card-section"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 pointer-fine:min-h-9">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 id={id} className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
              {title}
            </h3>
            {count !== undefined && count !== null ? (
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{count}</span>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn(CARD_X, "empty:hidden", className)} {...props} />
  );
}

/** Rows that run to the card's edges under one top rule, split by row rules. Each row pads itself with CARD_ROW. */
function CardList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="card-list"
      className={cn("flex flex-col divide-y border-t", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center border-t pt-4", CARD_X, className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardSection, CardContent, CardList, CardFooter, CARD_X, CARD_ROW };
