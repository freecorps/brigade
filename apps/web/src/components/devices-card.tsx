import { m, type Locale } from "@freecorps/brigade-i18n";
import { formatAge } from "@freecorps/brigade-i18n/incident";
import { MAX_DEVICES_PER_MEMBER, type DeviceSummaryRow } from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { BellIcon, PhoneCallIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useNow } from "@/components/incidents-card";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";

const text = (
  part: string,
  {
    max = 0,
    suffix = "",
    when = "",
    name = "",
  }: { max?: number; suffix?: string; when?: string; name?: string } = {},
): string => m.devices_card({ part, max, suffix, when, name });

/**
 * The signed-in member's own phones in this workspace (RFC 0006 "Device registration"), newest heard from first:
 * from the synced, token-free `member_devices` summary, never another member's (they are on the incident page's
 * "Why wasn't I paged?"). `device.unregister` only ever removes one's own, so no role sees a Remove for anyone else.
 * The exact reverse of the order `device.register` replaces in (least recently alive first, then the lower id), so
 * the last row is the one a new phone past the limit replaces: every registration and receipt moves `lastSeenAt`, so
 * it is never behind the device's own `updatedAt`.
 */
export function ownDevices(rows: readonly DeviceSummaryRow[], userId: string): DeviceSummaryRow[] {
  return rows
    .filter((row) => row.userId === userId)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.id.localeCompare(a.id));
}

export function DevicesCard() {
  const { userId } = useMember();
  const { locale } = usePreferences();
  const { rows, status } = useQuery("devices.all", {});
  const unregister = useMutation("device.unregister");
  const now = useNow(30_000);
  return (
    <DevicesPanel
      rows={ownDevices(rows, userId)}
      loading={status === "loading"}
      failed={status === "error"}
      locale={locale}
      now={now}
      onRemove={async (id) => {
        const outcome = await unregister({ id });
        // Gone already (removed from another tab, or replaced meanwhile): what the member asked for.
        return outcome.ok || outcome.error.code === "not_found";
      }}
    />
  );
}

type PanelProps = {
  /** The member's own phones, in the order shown. */
  rows: readonly DeviceSummaryRow[];
  loading: boolean;
  failed: boolean;
  locale: Locale;
  now: number;
  /** Resolves true once the shard dropped it. */
  onRemove: (id: string) => Promise<boolean>;
};

/** The card itself, without the hooks: what each state looks like (tested with made-up data). */
export function DevicesPanel({ rows, loading, failed, locale, now, onRemove }: PanelProps) {
  const titleId = useId();
  // The phone whose removal the shard refused: its row comes back from the optimistic drop and says so.
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Card aria-labelledby={titleId}>
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id={titleId}>{text("title")}</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">
          {text("description", { max: MAX_DEVICES_PER_MEMBER })}
        </p>
      </div>
      {loading ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">{text("loading")}</p>
        </CardContent>
      ) : failed ? (
        <CardContent>
          <FormError>{text("load_failed")}</FormError>
        </CardContent>
      ) : rows.length === 0 ? (
        <CardContent>
          <Empty>{text("empty")}</Empty>
        </CardContent>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((row) => (
            <DeviceItem
              key={row.id}
              row={row}
              locale={locale}
              now={now}
              refused={refused === row.id}
              onRemove={async () => {
                setRefused(null);
                // A mutation that throws (the client torn down, say) is a refusal too, never a stuck dialog.
                const ok = await onRemove(row.id).catch(() => false);
                if (!ok) setRefused(row.id);
                return ok;
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeviceItem({
  row,
  locale,
  now,
  refused,
  onRemove,
}: {
  row: DeviceSummaryRow;
  locale: Locale;
  now: number;
  refused: boolean;
  onRemove: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) goRef.current?.focus();
  }, [confirm]);
  const name = text(`platform_${row.platform}`);
  // Android has one push environment (FCM), registered as `production`: naming a store build would be wrong there.
  const build = row.platform === "ios" ? text(`env_${row.environment}`) : null;
  const facts: string[] = [
    ...(build === null ? [] : [build]),
    text("id", { suffix: row.id.slice(-4) }),
    text("registered", { when: formatAge(row.registeredAt, now, locale) }),
  ];
  const CallsIcon = row.voip ? PhoneCallIcon : BellIcon;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 gap-3">
          <SmartphoneIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium [overflow-wrap:anywhere]">{name}</p>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {facts.join(" · ")}
            </p>
            <p className="text-sm [overflow-wrap:anywhere]" title={text("seen_hint")}>
              {text("seen", { when: formatAge(row.lastSeenAt, now, locale) })}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CallsIcon aria-hidden className="size-3.5 shrink-0" />
              {text(row.voip ? "calls_on" : "calls_off")}
            </p>
          </div>
        </div>
        {!confirm ? (
          <Button
            variant="outline"
            aria-label={text("remove_label", { name })}
            onClick={() => setConfirm(true)}
          >
            {text("remove")}
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted p-3">
          <p className="max-w-prose text-sm text-foreground [overflow-wrap:anywhere]">
            {text("remove_confirm", { name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={goRef}
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (await onRemove()) setConfirm(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {text(busy ? "removing" : "remove_go")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              {text("keep")}
            </Button>
          </div>
        </div>
      ) : null}
      {refused ? <FormError>{text("remove_failed")}</FormError> : null}
    </li>
  );
}
