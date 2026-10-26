import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { entryTime, formatAge, type People } from "@freecorps/brigade-i18n/incident";
import type {
  DeliveryRow,
  DeviceSummaryRow,
  EmailSettings,
  IncidentRow,
  MemberRow,
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
  MailIcon,
  ShieldIcon,
  SmartphoneIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  deliveryError,
  deviceLabel,
  emailText,
  memberName,
  memberText,
  missText,
  pageLabel,
  pagingMembers,
  ruleText,
  shortVerdict,
  stageText,
  stageTimes,
  targetedText,
  verdictText,
  verdictTone,
  whyPaged,
  whyText,
  type WhyPage,
  type WhyPaged,
  type WhyVerdict,
} from "@/lib/why-paged";

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
};

const VERDICT_ICONS: Record<WhyVerdict, LucideIcon> = {
  delivered: CircleCheckIcon,
  accepted: CircleDotIcon,
  sending: CircleDashedIcon,
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
 * paging did with them in a word, each a link to the step-by-step view. The signed-in member gets their own
 * "Why wasn't I paged?" link at the top.
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
  const shown = all ? ids : ids.slice(0, LIST_LIMIT);
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
        {ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">{whyText("empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((id) => {
              const why = explain(data, id);
              const Icon = VERDICT_ICONS[why.verdict];
              return (
                <li key={id} className="flex min-h-11 items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium" title={memberName(id, who)}>
                    {memberName(id, who)}
                  </span>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 text-xs",
                      TONE[verdictTone(why.verdict)],
                    )}
                  >
                    <Icon aria-hidden className="size-3.5" />
                    {shortVerdict(why.verdict)}
                  </span>
                  <WhyLink
                    number={number}
                    userId={id}
                    label={`${whyText("why_link")} ${memberName(id, who)}`}
                  >
                    {whyText("why_link")}
                  </WhyLink>
                </li>
              );
            })}
          </ul>
        )}
        {ids.length > LIST_LIMIT ? (
          <button
            type="button"
            onClick={() => setAll((current) => !current)}
            aria-expanded={all}
            className="min-h-11 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            {all
              ? m.incident_page({ part: "show_less" })
              : m.members_show_all({ count: ids.length })}
          </button>
        ) : null}
      </CardContent>
    </Card>
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
  const options = pagingMembers(data.members, data.deliveries, [userId]);
  const time = (at: number) => entryTime(at, now, locale, timeZone);
  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/incidents/$number"
        params={{ number: String(number) }}
        className="-ml-1 inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        <span className="min-w-0 truncate">{whyText("back", { name: title })}</span>
      </Link>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-balance [overflow-wrap:anywhere]">
          {userId === who.self ? whyText("why_title_you") : whyText("why_title", { name })}
        </h1>
        <MemberPicker id={pickId} number={number} options={options} value={userId} who={who} />
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 text-base font-medium",
            TONE[verdictTone(why.verdict)],
          )}
        >
          <Icon aria-hidden className="mt-1 size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{verdictText(why.verdict, name)}</span>
        </p>
      </header>

      <ol className="flex flex-col gap-4">
        <Step icon={UserRoundIcon}>{memberText(why.member.status, name)}</Step>
        <Step icon={CircleDotIcon}>{ruleText(why.rule)}</Step>
        {why.pages.map((page, index) => (
          <PageStep
            key={page.step ?? `interim-${index}`}
            page={page}
            name={name}
            who={who}
            time={time}
            locale={locale}
            timeZone={timeZone}
          />
        ))}
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
  who,
}: {
  id: string;
  number: number;
  options: readonly string[];
  value: string;
  who: People;
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
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {memberName(option, who)}
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
  name,
  who,
  time,
  locale,
  timeZone,
}: {
  page: WhyPage;
  name: string;
  who: People;
  time: (at: number) => string;
  locale: Locale;
  timeZone: string;
}) {
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
        {targetedText(page, name, who).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {page.misses.map((miss) => (
          <p key={`${miss.reason}-${miss.at}`} className={TONE.warn}>
            {missText(miss.reason, name)}
          </p>
        ))}
        {page.deliveries.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {page.deliveries.map(({ row, stage }) => (
              <li key={row.id} className="flex flex-col gap-1.5 rounded-md bg-muted/60 p-3">
                <span className="font-medium">{deviceLabel(row)}</span>
                <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {stageTimes(row).map(({ stage: one, at }) => (
                    <li
                      key={one}
                      className={cn(
                        "flex items-baseline justify-between gap-3",
                        at === null && "text-muted-foreground",
                      )}
                    >
                      <span>{stageText(one)}</span>
                      <span className="shrink-0 tabular-nums">
                        {at === null
                          ? "-"
                          : formatDateTime(at, locale, timeZone, { timeStyle: "medium" })}
                      </span>
                    </li>
                  ))}
                </ol>
                {deliveryError(row).map((line) => (
                  <p key={line} className={TONE.warn}>
                    {line}
                  </p>
                ))}
                {stage === "accepted" ? (
                  <p className="text-muted-foreground">{whyText("no_receipt")}</p>
                ) : null}
                {row.attempts > 1 ? (
                  <p className="text-muted-foreground">
                    {whyText("attempts", { detail: String(row.attempts) })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
