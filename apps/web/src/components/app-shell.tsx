import { m } from "@freecorps/brigade-i18n";
import { useQuery } from "@freecorps/brigade-sync/react";
import { Link, useMatches } from "@tanstack/react-router";
import { cn } from "cn";
import { MenuIcon, XIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { TimeZoneSync } from "@/components/email-cards";
import { usePreferences } from "@/components/preferences";
import {
  AccountMenu,
  LanguageMenu,
  SiteHeader,
  ThemeMenu,
  WorkspaceSwitcher,
} from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth";
import { ENVIRONMENT } from "@/lib/environment";
import {
  FOOTER_SECTIONS,
  NAV_GROUPS,
  SECTIONS,
  sectionLabel,
  type SectionId,
} from "@/lib/navigation";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * The dashboard section a route belongs to: it renders inside the app shell, which lights the section in the
     * sidebar and names it in the top bar. Routes without one (sign-in, invitations) get the plain header.
     */
    section?: SectionId;
    /**
     * Who sets the page's h1. `bar` (the default): the top bar's section name is the h1, and the page's cards carry
     * their own titles. `page`: the page has its own (an incident's title), and the bar's name links to the section.
     */
    heading?: "bar" | "page";
  }
}

/** The plain frame, for pages outside a workspace (sign-in, an invitation, the create-workspace form). */
export function PlainFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </>
  );
}

/**
 * The dashboard's frame (the "inset sheet"): the sidebar and the frame share one ground, a step darker than the
 * page, and the page rests on it as a sheet inset 8px with a 1px edge and no shadow, so it reads as the one thing
 * to look at. On wide screens the sheet scrolls inside the window and the sidebar stays put; on phones the sidebar
 * folds into a sheet from the left, the sheet becomes the whole page and the window scrolls.
 *
 * `live`: the workspace's shard is open (inside its SyncProvider), so the shell can show its counts and keep the
 * member's time zone (which their follow-up reminders follow) on this browser's, whichever page they open; while the
 * workspace still loads it shows the frame without them.
 */
export function AppShell({ live, children }: { live: boolean; children: ReactNode }) {
  // Read so a language switch rewords the sidebar and the top bar in place, like the pages below them.
  usePreferences();
  const session = authClient.useSession();
  const user = session.data?.user;
  return (
    <div className="flex min-h-dvh bg-sidebar md:h-dvh md:overflow-hidden">
      {live ? <TimeZoneSync /> : null}
      <aside className="hidden w-64 shrink-0 md:flex md:flex-col">
        <SidebarBody live={live} user={user} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="flex min-h-0 flex-1 flex-col bg-background md:overflow-hidden md:rounded-xl md:border">
          <TopBar live={live} user={user} />
          {/* The sheet's scroller on wide screens, so the top bar and the sheet's rounded corners stay put. Positioned,
              so anything absolute inside it (a visually hidden input, a live region) scrolls and clips with it instead
              of hanging off the window and giving the page a second scrollbar. */}
          <main
            id="main"
            tabIndex={-1}
            className="relative min-h-0 flex-1 outline-none md:overflow-y-auto md:[scrollbar-gutter:stable]"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** A section's content column: one width and one gutter for every dashboard page. */
export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

type User = { name: string; email: string } | undefined;

function SidebarBody({
  live,
  user,
  onNavigate,
}: {
  live: boolean;
  user: User;
  /** Closes the phone's sheet once a link is followed. */
  onNavigate?: () => void;
}) {
  return (
    <Sidebar>
      <SidebarHeader>
        <WorkspaceSwitcher place="sidebar" />
      </SidebarHeader>
      <nav aria-label={m.nav({ part: "label" })} className="flex min-h-0 flex-1 flex-col">
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <NavGroup key={group.id} label={m.nav({ part: group.id })}>
              {group.sections.map((id) => (
                <NavItem key={id} id={id} live={live} onNavigate={onNavigate} />
              ))}
            </NavGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {FOOTER_SECTIONS.map((id) => (
              <NavItem key={id} id={id} live={live} onNavigate={onNavigate} />
            ))}
          </SidebarMenu>
        </SidebarFooter>
      </nav>
      {user ? (
        <div className="px-2 pb-2">
          <AccountMenu name={user.name} email={user.email} place="sidebar" />
        </div>
      ) : null}
    </Sidebar>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <SidebarGroup role="group" aria-labelledby={id}>
      <SidebarGroupLabel id={id}>{label}</SidebarGroupLabel>
      <SidebarMenu>{children}</SidebarMenu>
    </SidebarGroup>
  );
}

function NavItem({
  id,
  live,
  onNavigate,
}: {
  id: SectionId;
  live: boolean;
  onNavigate?: () => void;
}) {
  const section = SECTIONS[id];
  const Icon = section.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <Link
            to={section.to}
            // The overview is `/`: only it, not every page under it. Others stay lit on their detail pages.
            activeOptions={{ exact: section.to === "/" }}
            onClick={onNavigate}
          />
        }
      >
        <Icon aria-hidden />
        <span>{sectionLabel(id)}</span>
        {live && id === "incidents" ? <OpenIncidentsBadge /> : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * How many incidents are open now, on the Incidents row; nothing while none are or the list loads. While a SEV1 is
 * open the number turns SEV1 red behind a dot, the one mark in the sidebar that says something is on fire.
 */
function OpenIncidentsBadge() {
  const { rows, status } = useQuery("incidents.active", {});
  if (status !== "ready" || rows.length === 0) return null;
  const fire = rows.some((row) => row.severity === "sev1");
  return (
    <SidebarMenuBadge
      data-sev1={fire || undefined}
      className={cn(fire && "inline-flex items-center gap-1.5 font-semibold text-destructive")}
    >
      {fire ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {rows.length}
    </SidebarMenuBadge>
  );
}

function TopBar({ live, user }: { live: boolean; user: User }) {
  const section = useMatches({
    select: (matches) => {
      const match = matches.findLast((entry) => entry.staticData.section);
      return match
        ? { id: match.staticData.section!, heading: match.staticData.heading ?? "bar" }
        : undefined;
    },
  });
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-4 md:static md:h-13 md:px-6">
      <MobileNav live={live} user={user} />
      {section ? <SectionName id={section.id} heading={section.heading} /> : null}
      {/* Production is what Brigade is: only the other environments say which they are. */}
      {ENVIRONMENT === "production" ? null : (
        <span className="hidden h-6 shrink-0 items-center rounded-sm bg-muted px-2 text-xs font-medium text-muted-foreground sm:inline-flex">
          {m.environment({ env: ENVIRONMENT, part: "badge" })}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <LanguageMenu place="bar" />
        <ThemeMenu place="bar" />
      </div>
    </header>
  );
}

/** The page's name: its h1, or, on a detail page with its own h1, a link back to the section. */
function SectionName({ id, heading }: { id: SectionId; heading: "bar" | "page" }) {
  const label = sectionLabel(id);
  // The section's sidebar icon leads its name, so the bar reads as where you are rather than as a second title.
  const Icon = SECTIONS[id].icon;
  const icon = <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  if (heading === "bar") {
    return (
      <h1 className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
        {icon}
        <span className="truncate">{label}</span>
      </h1>
    );
  }
  return (
    <Link
      to={SECTIONS[id].to}
      className="-mx-1 inline-flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring md:min-h-8"
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** The sidebar on phones: a menu button in the top bar opens it as a sheet from the left. */
function MobileNav({ live, user }: { live: boolean; user: User }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
        <MenuIcon aria-hidden />
        <span className="sr-only">{m.nav({ part: "open" })}</span>
      </SheetTrigger>
      <SheetContent>
        <div className="flex items-center justify-between px-2 pt-2">
          <SheetTitle className="sr-only">{m.nav({ part: "menu" })}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon" className="ml-auto" />}>
            <XIcon aria-hidden />
            <span className="sr-only">{m.nav({ part: "close" })}</span>
          </SheetClose>
        </div>
        <SidebarBody live={live} user={user} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
