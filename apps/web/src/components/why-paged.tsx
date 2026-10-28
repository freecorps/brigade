import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { entryTime, formatAge, type People } from "@freecorps/brigade-i18n/incident";
import type {
  DeliveryRow,
  DeviceSummaryRow,
  EmailSettings,
  IncidentRow,
  MemberRow,
  MemberSettingsRow,
  ScheduleRow,
  TimelineRow,
} from "@freecorps/brigade-schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  BellOffIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleOffIcon,
  MailIcon,
  PhoneCallIcon,
  ShieldIcon,
  SmartphoneIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import {
  whyPaged,
  type WhyCall,
  type WhyDelivery,
  type WhyPage,
  type WhyPaged,
  type WhyVerdict,
} from "@freecorps/brigade-sync";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  byUrgency,
  callChoiceText,
  callLabel,
  callTone,
  deliveryError,
  deviceLabel,
  emailText,
  memberName,
  memberText,
  missText,
  pageGroups,
  pageLabel,
  pagingMembers,
  ruleText,
  sameOutcomeText,
  shortCall,
  shortVerdict,
  stageText,
  stageTimes,
  targetedText,
  verdictText,
  verdictTone,
  whyText,
} from "@freecorps/brigade-i18n/why-paged";

/** Members listed before "Show all": enough for a small team, short enough to keep the roles in view. */
const LIST_LIMIT = 8;

/** What every why-wasn't-I-paged view reads: the incident's rows and the workspace's. */
export type PagingData = {
  incident: IncidentRow;
  members: readonly MemberRow[];
  devices: readonly DeviceSummaryRow[];
  deliveries: readonly DeliveryRow[];
  timeline: readonly TimelineRow[];
  schedules: readonly ScheduleRow[];
  email?: EmailSettings;
  /** Members' own paging settings (which pages ring them as a call); absent: the defaults. */
  settings?: readonly MemberSettingsRow[];
  /** The time now: a page planned long ago and never sent is stuck, not on its way. */
  now: number;
};

/** Phones on one page past which each shows only its furthest stage: a team with many phones stays readable. */
const COMPACT_DEVICES = 3;

const VERDICT_ICONS: Record<WhyVerdict, LucideIcon> = {
  delivered: CircleCheckIcon,
  accepted: CircleDotIcon,
  sending: CircleDashedIcon,
  stuck: CircleOffIcon,
  failed: CircleAlertIcon,
  missed: CircleAlertIcon,
  declarer: UserRoundIcon,
  excluded: ShieldIcon,
  not_targeted: CircleDashedIcon,
  none: CircleDashedIcon,
};

const TONE = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  neutral: "text-muted-foreground",
} as const;

function explain(data: PagingData, userId: string): WhyPaged {
  return whyPaged({ ...data, userId });
}

/**
 * The incident page's compact list: every member who can respond (and anyone else a page touched), with what
 * paging did with them in a word, whoever needs a look first (`byUrgency`), each a link to the step-by-step view.
 * The signed-in member gets their own "My paging" link at the top. On a phone each name has its own line, the
 * outcome and the link below it, so a long name in pt-BR never loses to them.
 */
export function PagingCard({
  data,
  who,
  number,
}: {
  data: PagingData;
  who: People;
  number: number;
}) {
  const [all, setAll] = useState(false);
  const touched = data.timeline.flatMap((entry) =>
    entry.kind === "page_failed" && entry.userId !== null ? [entry.userId] : [],
  );
  const ids = pagingMembers(data.members, data.deliveries, touched);
  const rows = byUrgency(
    ids.map((id) => {
      const why = explain(data, id);
      return { id, verdict: why.verdict, call: why.call };
    }),
  );
  const shown = all ? rows : rows.slice(0, LIST_LIMIT);
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId}>
      <CardTitle id={titleId} className="px-4 sm:px-6">
        {whyText("title")}
      </CardTitle>
      <CardContent className="flex flex-col gap-3">
        <WhyLink number={number} userId={who.self} className="self-start">
          {whyText("why_title_you")}
        </WhyLink>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{whyText("empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {shown.map(({ id, verdict, call }) => {
              const Icon = VERDICT_ICONS[verdict];
              const name = memberName(id, who);
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-x-3 border-b border-border/60 py-1.5 text-sm last:border-b-0 sm:min-h-11 sm:flex-nowrap sm:border-b-0 sm:py-0"
                >
                  <span
                    className="min-w-0 basis-full font-medium [overflow-wrap:anywhere] sm:flex-1 sm:basis-auto sm:truncate"
                    title={name}
                  >
                    {name}
                  </span>
                  <span
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-1.5 text-xs sm:flex-none sm:shrink-0",
                      TONE[verdictTone(verdict)],
                    )}
                  >
                    <Icon aria-hidden className="size-3.5 shrink-0" />
                    {shortVerdict(verdict)}
                  </span>
                  {call ? <CallWord call={call} /> : null}
                  <WhyLink
                    number={number}
                    userId={id}
                    label={whyText("why_link_label", { name })}
                    className="ml-auto"
                  >
                    {whyText("why_link")}
                  </WhyLink>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > LIST_LIMIT ? (
          <button
            type="button"
            onClick={() => setAll((current) => !current)}
            aria-expanded={all}
            className="min-h-11 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            {all
              ? m.incident_page({ part: "show_less" })
              : m.members_show_all({ count: rows.length })}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The calls a member's pages rang them with, in a word, next to what the pages did: never in its place. */
function CallWord({ call }: { call: WhyCall }) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1.5 text-xs sm:shrink-0", TONE[callTone(call)])}
    >
      <PhoneCallIcon aria-hidden className="size-3.5 shrink-0" />
      {shortCall(call)}
    </span>
  );
}

function WhyLink({
  number,
  userId,
  label,
  className,
  children,
}: {
  number: number;
  userId: string;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/incidents/$number"
      params={{ number: String(number) }}
      search={{ why: userId }}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring",
        className,
      )}
    >
      <CircleHelpIcon aria-hidden className="size-4" />
      {children}
    </Link>
  );
}

/**
 * "Why wasn't I paged?" for one incident and one member, step by step: can they be paged at all, which rule paged,
 * each page (were they on it, and if not why; each device's stages with times and errors), the phones they have
 * now, the email about a missed page, and the acknowledgement that stopped it.
 */
export function WhyPagedView({
  data,
  who,
  userId,
  number,
  title,
  locale,
  timeZone,
  now,
}: {
  data: PagingData;
  who: People;
  userId: string;
  number: number;
  title: string;
  locale: Locale;
  timeZone: string;
  now: number;
}) {
  const why = explain(data, userId);
  const name = memberName(userId, who);
  const Icon = VERDICT_ICONS[why.verdict];
  const pickId = useId();
  const [allPages, setAllPages] = useState(false);
  const groups = pageGroups(why.pages);
  const grouped = groups.length < why.pages.length;
  const pages = allPages ? why.pages.map((page) => ({ page, earlier: 0 })) : groups;
  // By name, numbers in order ("Ana 2" before "Ana 10").
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const options = pagingMembers(data.members, data.deliveries, [userId])
    .map((id) => ({ id, name: memberName(id, who) }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const time = (at: number) => entryTime(at, now, locale, timeZone);
  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/incidents/$number"
        params={{ number: String(number) }}
        className="-ml-1 inline-flex min-h-11 max-w-full items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{whyText("back", { name: title })}</span>
      </Link>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-balance [overflow-wrap:anywhere]">
          {userId === who.self ? whyText("why_title_you") : whyText("why_title", { name })}
        </h1>
        <MemberPicker id={pickId} number={number} options={options} value={userId} />
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 text-base font-medium",
            TONE[verdictTone(why.verdict)],
          )}
        >
          <Icon aria-hidden className="mt-1 size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{verdictText(why, name)}</span>
        </p>
      </header>

      <ol className="flex flex-col gap-4">
        <Step icon={UserRoundIcon}>{memberText(why.member.status, name)}</Step>
        <Step icon={CircleDotIcon}>{ruleText(why.rule)}</Step>
        {pages.map(({ page, earlier }, index) => (
          <PageStep
            key={page.step ?? `interim-${index}`}
            page={page}
            earlier={earlier}
            name={name}
            who={who}
            time={time}
            locale={locale}
            timeZone={timeZone}
          />
        ))}
        {grouped ? (
          <li className="pl-7">
            <button
              type="button"
              onClick={() => setAllPages((current) => !current)}
              aria-expanded={allPages}
              className="min-h-11 rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
            >
              {allPages
                ? m.incident_page({ part: "show_less" })
                : whyText("pages_show_all", { detail: String(why.pages.length) })}
            </button>
          </li>
        ) : null}
        <Step icon={SmartphoneIcon} title={whyText("devices_title")}>
          {why.devices.length === 0 ? (
            <p>{whyText("devices_none")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {why.devices.map((device) => (
                <li key={device.id} className="flex flex-col">
                  <span className="font-medium">{deviceLabel(device)}</span>
                  <span className="text-muted-foreground">
                    {whyText("seen", { time: formatAge(device.lastSeenAt, now, locale) })}
                    {device.voip ? ` · ${whyText("calls")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Step>
        <Step icon={PhoneCallIcon}>{callChoiceText(why.calls, name)}</Step>
        {why.email ? <Step icon={MailIcon}>{emailText(why.email, name)}</Step> : null}
        {why.acknowledged ? (
          <Step icon={BellOffIcon}>
            {whyText("acknowledged", {
              name: memberName(why.acknowledged.by, who),
              time: formatAge(why.acknowledged.at, now, locale),
            })}
          </Step>
        ) : null}
      </ol>
      <p className="text-xs text-muted-foreground">{whyText("privacy")}</p>
    </div>
  );
}

/** A native select, the right control on phones: picking someone opens their view. */
function MemberPicker({
  id,
  number,
  options,
  value,
}: {
  id: string;
  number: number;
  options: readonly { id: string; name: string }[];
  value: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-xs">
      <label htmlFor={id} className="text-sm font-medium text-muted-foreground">
        {whyText("pick_member")}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) =>
          void navigate({
            to: "/incidents/$number",
            params: { number: String(number) },
            search: { why: event.currentTarget.value },
          })
        }
        className="field w-full px-3 focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 [overflow-wrap:anywhere]">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </li>
  );
}

function PageStep({
  page,
  earlier,
  name,
  who,
  time,
  locale,
  timeZone,
}: {
  page: WhyPage;
  /** Pages before this one with the same outcome, folded into it. */
  earlier: number;
  name: string;
  who: People;
  time: (at: number) => string;
  locale: Locale;
  timeZone: string;
}) {
  const compact = page.deliveries.length > COMPACT_DEVICES;
  const compactCalls = page.calls.length > COMPACT_DEVICES;
  const at = (value: number) => (
    <time
      className="shrink-0 tabular-nums"
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value, locale, timeZone)}
    >
      {formatDateTime(value, locale, timeZone, { timeStyle: "medium" })}
    </time>
  );
  return (
    <li className="flex gap-3 text-sm">
      <CircleDotIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 [overflow-wrap:anywhere]">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{pageLabel(page)}</span>
          <time
            className="text-muted-foreground tabular-nums"
            dateTime={new Date(page.at).toISOString()}
            title={formatDateTime(page.at, locale, timeZone)}
          >
            {time(page.at)}
          </time>
        </p>
        {earlier > 0 ? <p className="text-muted-foreground">{sameOutcomeText(earlier)}</p> : null}
        {targetedText(page, name, who).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {page.misses.map((miss) => (
          <p key={`${miss.reason}-${miss.at}`} className={TONE.warn}>
            {missText(miss.reason, name)}
          </p>
        ))}
        {page.deliveries.length > 0 ? (
          <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
            {page.deliveries.map((delivery) => (
              <DeliveryItem key={delivery.row.id} delivery={delivery} compact={compact} at={at} />
            ))}
          </ul>
        ) : null}
        {page.calls.length > 0 ? (
          // Calls apart from the pushes: they ring after them and never change whether the page got through.
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground">{whyText("call_note")}</p>
            <ul className={cn("flex flex-col", compactCalls ? "gap-1.5" : "gap-3")}>
              {page.calls.map((delivery) => (
                <DeliveryItem
                  key={delivery.row.id}
                  delivery={delivery}
                  compact={compactCalls}
                  at={at}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One device's push or call on a page: each stage with its time (only the furthest when `compact`), and why it stopped.
 * A call has no delivered stage, and one never sent was held back because its push never got through.
 */
function DeliveryItem({
  delivery: { row, stage, stuck },
  compact,
  at,
}: {
  delivery: WhyDelivery;
  compact: boolean;
  at: (value: number) => React.ReactNode;
}) {
  const call = row.kind === "call";
  const reached = stageTimes(row, stuck);
  const furthest = reached.filter((one) => one.at !== null).at(-1)!;
  return (
    <li
      className={cn(
        "flex flex-col rounded-md bg-muted/60",
        compact ? "gap-0.5 px-3 py-2" : "gap-1.5 p-3",
      )}
    >
      <span className="font-medium">{call ? callLabel(row) : deviceLabel(row)}</span>
      {compact ? (
        // Many phones: each one's furthest stage only, still with its time.
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span>{stageText(furthest.stage)}</span>
          {at(furthest.at!)}
        </p>
      ) : (
        <ol className="flex flex-col gap-y-1">
          {reached.map(({ stage: one, at: when, stopped }) => (
            <li
              key={one}
              className={cn(
                "flex flex-wrap items-baseline justify-between gap-x-3",
                when === null && "text-muted-foreground",
              )}
            >
              <span>{stageText(one)}</span>
              {when !== null ? (
                at(when)
              ) : (
                <span className={cn("shrink-0", stopped && TONE.warn)}>
                  {whyText(stopped ? "stage_stopped" : "stage_none")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {stuck ? <p className={TONE.warn}>{whyText(call ? "call_not_sent" : "stuck_note")}</p> : null}
      {deliveryError(row).map((line) => (
        <p key={line} className={TONE.warn}>
          {line}
        </p>
      ))}
      {stage === "accepted" && !compact && !call ? (
        <p className="text-muted-foreground">{whyText("no_receipt")}</p>
      ) : null}
      {row.attempts > 1 ? (
        <p className="text-muted-foreground">
          {whyText("attempts", { detail: String(row.attempts) })}
        </p>
      ) : null}
    </li>
  );
}
