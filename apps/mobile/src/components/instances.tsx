// The instances on this phone as the screens read them (RFC 0015 sections 5 and 8): the list, what each session says
// (src/lib/instance-clients.ts `board`), which relay each pages through, grouped for the switcher
// (src/lib/switcher.ts), and the words for each answer.
import { m } from "@freecorps/brigade-i18n";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { pagingText } from "@/components/account";
import { board, instances, relayOf } from "@/lib/instance-clients";
import type { AddressProblem, AddressVerdict } from "@/lib/instance-address";
import type { Instances } from "@/lib/instances";
import type { EndReason } from "@/lib/qr-sign-in";
import {
  switcherGroups,
  type RelayView,
  type SwitcherGroup,
  type SwitcherRow,
} from "@/lib/switcher";

/** `m.mobile_instances` with its inputs filled in. */
export function say(part: string, host = "", name = ""): string {
  return m.mobile_instances({ part, host, name });
}

export function useInstanceList(): Instances {
  return useSyncExternalStore(instances.subscribe, instances.current);
}

export function useBoard() {
  return useSyncExternalStore(board.subscribe, board.current);
}

/**
 * Which relay each listed instance pages through, as each `/config` answers (`unknown` until then). Asked again when
 * the screen comes into focus and when the app comes back to the foreground: an answer kept is read from the cache,
 * and one that failed or said nothing (`unknown`, which the cache drops) is asked anew.
 */
export function useRelays(list: Instances): Record<string, RelayView> {
  const [relays, setRelays] = useState<Record<string, RelayView>>({});
  const [round, setRound] = useState(0);
  const key = list.instances.map((one) => `${one.id} ${one.origin}`).join(",");
  useFocusEffect(
    useCallback(() => {
      setRound((value) => value + 1);
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRound((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let live = true;
    for (const instance of list.instances) {
      // A failure leaves that instance's relay unknown; the cache dropped it, so the next screen to show it asks again.
      void relayOf(instance)
        .catch((): RelayView => ({ kind: "unknown" }))
        .then((view) => {
          if (live) setRelays((current) => ({ ...current, [instance.id]: view }));
        });
    }
    return () => {
      live = false;
    };
    // `key` names the instances (an activation alone asks nothing again); `round` is a focus or a foreground.
  }, [key, round]);
  return relays;
}

/** Every instance with its workspaces and paging, grouped (src/lib/switcher.ts `switcherGroups`). */
export function useSwitcher(): {
  list: Instances;
  groups: SwitcherGroup[];
  relays: Record<string, RelayView>;
} {
  const list = useInstanceList();
  const states = useBoard();
  const relays = useRelays(list);
  const groups = useMemo(
    () => switcherGroups({ list, states, relays, unnamed: say("unnamed") }),
    [list, states, relays],
  );
  return { list, groups, relays };
}

/** A switcher row's paging state, in words. */
export function rowPagingText(row: Pick<SwitcherRow, "paging" | "detail">): string {
  switch (row.paging) {
    case "on":
      return m.account_flow({ part: "paged_here", name: "" });
    case "pending":
      return m.mobile_session({ part: "pages_pending" });
    case "foreign":
      return say("paging_foreign");
    case "no-relay":
      return say("paging_no_relay");
    default:
      return row.detail ? pagingText(row.detail) : m.mobile_session({ part: "pages_failed" });
  }
}

/** Which relay an instance pages through, in words (its details sheet). */
export function relayText(relay: RelayView, isDefault: boolean): string {
  switch (relay.kind) {
    case "freecorps":
      return say("relay_freecorps");
    case "own":
      return say("relay_own", relay.host);
    case "none":
      // The build's default instance pages with the raw tokens, as before relay handles.
      return isDefault ? say("relay_default_raw") : say("relay_none");
    default:
      return say("relay_unknown");
  }
}

/** Why an address is refused or what it needs, in words; undefined when it can be signed in to. */
export function verdictText(
  verdict: AddressVerdict | { kind: AddressProblem },
  host: string,
): { title?: string; text: string; app?: string } | undefined {
  switch (verdict.kind) {
    case "invalid":
      return { text: say("invalid") };
    case "insecure":
      return { text: say("insecure") };
    case "not-brigade":
      return { text: say("not_brigade") };
    case "unreachable":
      return { text: say("unreachable", host) };
    case "update-app":
      return { title: say("update_title"), text: say("update_body", host) };
    case "own-app":
      return {
        title: say("own_app_title"),
        text: say("own_app_body", host),
        ...(verdict.app ? { app: verdict.app } : {}),
      };
    default:
      return undefined;
  }
}

/** Why a QR sign-in ended, in words. */
export function endText(reason: EndReason, host: string): string {
  return say(`ended_${reason}`, host);
}
