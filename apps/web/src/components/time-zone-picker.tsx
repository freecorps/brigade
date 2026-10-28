import { Combobox } from "@base-ui/react/combobox";
import { m } from "@freecorps/brigade-i18n";
import { canonicalTimeZone } from "@freecorps/brigade-schema";
import { cn } from "cn";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";
import {
  matchZone,
  offsetLabel,
  zoneGroups,
  zoneLabel,
  type ZoneChoice,
  type ZoneGroup,
} from "@/lib/oncall";

/**
 * A searchable time zone picker (Base UI's Combobox): typing matches a city anywhere in the zone's name, current
 * or older ("paulo", "kolkata" or "calcutta"), or an offset ("+05:45", "utc-3"). The viewer's zone and the zones
 * the workspace already uses come first; every zone shows its current name and its UTC offset now. Only zones the
 * runtime knows can be picked, and the value is the runtime's spelling ("Asia/Calcutta" in V8).
 */
export function TimeZonePicker({
  id,
  value,
  viewerZone,
  used,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  viewerZone: string;
  /** Zones the workspace's schedules use (and the one being edited), offered first. */
  used: readonly string[];
  invalid?: boolean;
  onChange: (zone: string) => void;
}) {
  // Offsets as of opening the form: they only move at a DST change.
  const [groups] = useState<ZoneGroup[]>(() => zoneGroups(Date.now(), viewerZone, used));
  const selected = groups.flatMap((group) => group.items).find((zone) => zone.value === value) ?? {
    value,
    label: zoneLabel(value),
    // A zone this runtime does not know (a draft being checked, or ICU skew) shows no offset rather than throwing.
    offset: canonicalTimeZone(value) === undefined ? "" : offsetLabel(value, Date.now()),
    search: "",
  };
  return (
    <Combobox.Root
      items={groups}
      value={selected}
      onValueChange={(zone: ZoneChoice | null) => {
        if (zone) onChange(zone.value);
      }}
      itemToStringLabel={(zone: ZoneChoice) => zone.label}
      isItemEqualToValue={(a: ZoneChoice, b: ZoneChoice) => a.value === b.value}
      filter={(zone: ZoneChoice, query: string) => matchZone(zone, query)}
      autoHighlight
    >
      <Combobox.InputGroup className="relative">
        <Combobox.Input
          id={id}
          placeholder={m.oncall_zone({ part: "placeholder" })}
          aria-invalid={invalid ? true : undefined}
          className="field w-full min-w-0 pr-11 pl-3 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        <Combobox.Trigger
          aria-label={m.oncall_field({ field: "time_zone" })}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <ChevronsUpDownIcon aria-hidden className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          className="isolate z-50 outline-none"
          sideOffset={4}
          collisionPadding={16}
        >
          <Combobox.Popup
            className={cn(
              "w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none",
              "transition-[opacity,scale] duration-(--brigade-duration-fast) ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100",
            )}
          >
            <Combobox.Empty>
              <p className="px-3 py-4 text-sm text-muted-foreground">
                {m.oncall_zone({ part: "empty" })}
              </p>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(22rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 outline-none data-empty:p-0">
              {(group: ZoneGroup) => (
                <Combobox.Group key={group.value} items={group.items} className="pb-1 last:pb-0">
                  <Combobox.GroupLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground select-none">
                    {m.oncall_zone({ part: group.value })}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(zone: ZoneChoice) => (
                      <Combobox.Item
                        key={zone.value}
                        value={zone}
                        className="grid min-h-11 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-3 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <Combobox.ItemIndicator className="col-start-1 flex">
                          <CheckIcon aria-hidden className="size-4" />
                        </Combobox.ItemIndicator>
                        <span className="col-start-2 min-w-0 [overflow-wrap:anywhere]">
                          {zone.label}
                          {zone.value === viewerZone ? (
                            <span className="block text-xs text-muted-foreground">
                              {m.oncall_zone({ part: "yours" })}
                            </span>
                          ) : null}
                        </span>
                        <span className="col-start-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {zone.offset}
                        </span>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
