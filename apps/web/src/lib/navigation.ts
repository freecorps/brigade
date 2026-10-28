// The dashboard's sections: what the sidebar lists, in its order, and what the top bar names the page. Respond holds
// what people open during an incident and every day; Configure what they set up once and come back to. The workspace's
// own settings and the member's account sit at the sidebar's foot.
import { m } from "@freecorps/brigade-i18n";
import {
  ActivityIcon,
  ArrowUpNarrowWideIcon,
  BellIcon,
  CalendarClockIcon,
  CircleUserRoundIcon,
  GlobeIcon,
  HouseIcon,
  LayersIcon,
  ListChecksIcon,
  PlugIcon,
  SettingsIcon,
  SirenIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type SectionId =
  | "overview"
  | "incidents"
  | "follow_ups"
  | "on_call"
  | "monitors"
  | "services"
  | "escalation"
  | "alerts"
  | "integrations"
  | "status_page"
  | "members"
  | "settings"
  | "account";

export type SectionPath =
  | "/"
  | "/incidents"
  | "/follow-ups"
  | "/on-call"
  | "/monitors"
  | "/services"
  | "/escalation"
  | "/alerts"
  | "/integrations"
  | "/status-page"
  | "/members"
  | "/settings"
  | "/account";

export type Section = { id: SectionId; to: SectionPath; icon: LucideIcon };

export const SECTIONS: Record<SectionId, Section> = {
  overview: { id: "overview", to: "/", icon: HouseIcon },
  incidents: { id: "incidents", to: "/incidents", icon: SirenIcon },
  follow_ups: { id: "follow_ups", to: "/follow-ups", icon: ListChecksIcon },
  on_call: { id: "on_call", to: "/on-call", icon: CalendarClockIcon },
  monitors: { id: "monitors", to: "/monitors", icon: ActivityIcon },
  services: { id: "services", to: "/services", icon: LayersIcon },
  escalation: { id: "escalation", to: "/escalation", icon: ArrowUpNarrowWideIcon },
  alerts: { id: "alerts", to: "/alerts", icon: BellIcon },
  integrations: { id: "integrations", to: "/integrations", icon: PlugIcon },
  status_page: { id: "status_page", to: "/status-page", icon: GlobeIcon },
  members: { id: "members", to: "/members", icon: UsersIcon },
  settings: { id: "settings", to: "/settings", icon: SettingsIcon },
  account: { id: "account", to: "/account", icon: CircleUserRoundIcon },
};

/** The sidebar's groups, in order; settings and account are in its footer. */
export const NAV_GROUPS: { id: "respond" | "configure"; sections: SectionId[] }[] = [
  {
    id: "respond",
    sections: ["overview", "incidents", "follow_ups", "on_call", "monitors", "services"],
  },
  {
    id: "configure",
    sections: ["escalation", "alerts", "integrations", "status_page", "members"],
  },
];

export const FOOTER_SECTIONS: SectionId[] = ["settings", "account"];

/** A section's name, in the sidebar, the top bar and the tab title. */
export function sectionLabel(id: SectionId): string {
  return m.nav({ part: id });
}
