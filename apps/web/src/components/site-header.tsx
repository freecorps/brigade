import { isLocale, locales, m, type Locale } from "@freecorps/brigade-i18n";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CircleUserRoundIcon,
  LanguagesIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient, saveLocale, switchWorkspace } from "@/lib/auth";
import { ENVIRONMENT } from "@/lib/environment";
import { isThemePreference, themePreferences, type ThemePreference } from "@/lib/theme";

const LANGUAGE_NAMES: Record<Locale, () => string> = {
  en: m.language_name_en,
  "pt-BR": m.language_name_pt_br,
};

const THEMES: Record<ThemePreference, { icon: LucideIcon; name: () => string }> = {
  light: { icon: SunIcon, name: m.theme_light },
  dark: { icon: MoonIcon, name: m.theme_dark },
  system: { icon: MonitorIcon, name: m.theme_system },
};

export function SiteHeader() {
  const session = authClient.useSession();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="-mx-2 flex h-11 shrink-0 items-center gap-2 rounded-md px-2 text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <BrigadeMark />
          {/* On phones the workspace name takes the room; the mark still says which app this is. Signed in without a
              workspace (the create-workspace form), there is no name, so the app's stays. */}
          <span
            className={session.data?.session.activeOrganizationId ? "max-sm:sr-only" : undefined}
          >
            {m.app_name()}
          </span>
        </Link>
        {session.data ? <WorkspaceSwitcher /> : null}
        {/* Production is what Brigade is: only the other environments say which they are. */}
        {ENVIRONMENT === "production" ? null : (
          <span className="hidden h-6 shrink-0 items-center rounded-sm bg-muted px-2 text-xs font-medium text-muted-foreground lg:inline-flex">
            {m.environment({ env: ENVIRONMENT, part: "badge" })}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LanguageMenu />
          <ThemeMenu />
          {session.data ? (
            <AccountMenu name={session.data.user.name} email={session.data.user.email} />
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * The active workspace, after a slash, as in a breadcrumb, and the switcher: the member's workspaces (Better Auth's
 * organization list) and New workspace. Switching makes the chosen one active in the session; the dashboard then opens
 * its shard (components/session), and changes still waiting for the old one's shard are sent there all the same.
 * Truncated; the full name is in its title and in the account menu.
 */
function WorkspaceSwitcher() {
  const workspace = authClient.useActiveOrganization();
  const list = authClient.useListOrganizations();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const name = workspace.data?.name;
  if (!name) return null;
  const pick = async (id: string) => {
    if (id === workspace.data?.id || switching) return;
    setSwitching(id);
    setFailed(false);
    const switched = await switchWorkspace(id);
    setSwitching(null);
    if (!switched) {
      setFailed(true);
      return;
    }
    setOpen(false);
    // Another workspace's incident or service numbers mean nothing here.
    await navigate({ to: "/" });
  };
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm font-medium">
      <span aria-hidden className="text-lg font-light text-border max-sm:hidden">
        /
      </span>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setFailed(false);
            void list.refetch();
          }
        }}
      >
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="-mx-2 h-11 min-w-0 gap-1.5 px-2" />}
        >
          <span className="sr-only">{m.workspace_label()}: </span>
          <span className="truncate" title={name}>
            {name}
          </span>
          <ChevronsUpDownIcon aria-hidden className="text-muted-foreground" />
          <span className="sr-only">{m.account_flow({ part: "switcher", name: "" })}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {m.account_flow({ part: "workspaces", name: "" })}
            </DropdownMenuLabel>
            {list.data ? (
              <DropdownMenuRadioGroup
                value={workspace.data?.id ?? ""}
                onValueChange={(value) => void pick(String(value))}
              >
                {list.data.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.id}
                    value={option.id}
                    closeOnClick={false}
                    disabled={switching !== null}
                    aria-label={
                      option.id === workspace.data?.id
                        ? undefined
                        : m.account_flow({ part: "switch_to", name: option.name })
                    }
                  >
                    <span className="min-w-0 truncate" title={option.name}>
                      {option.name}
                    </span>
                    {switching === option.id ? (
                      <LoaderCircleIcon
                        aria-hidden
                        className="ml-auto animate-spin text-muted-foreground motion-reduce:animate-none"
                      />
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : list.error ? (
              <p className="px-3 py-2 text-sm text-destructive">
                {m.account_flow({ part: "list_failed", name: "" })}
              </p>
            ) : (
              <p
                role="status"
                className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
              >
                <LoaderCircleIcon
                  aria-hidden
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {m.session_loading()}
              </p>
            )}
            {failed ? (
              <p role="alert" className="px-3 py-2 text-sm text-destructive">
                {m.account_flow({ part: "switch_failed", name: "" })}
              </p>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate({ to: "/workspaces/new" })}>
            <PlusIcon aria-hidden className="text-muted-foreground" />
            {m.account_flow({ part: "new_workspace", name: "" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AccountMenu({ name, email }: { name: string; email: string }) {
  const workspace = authClient.useActiveOrganization().data?.name;
  const signOut = async () => {
    try {
      await authClient.signOut();
    } finally {
      // A full load: it drops the tab's sync client, its socket and every row it held for this member.
      window.location.assign("/sign-in");
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
        <CircleUserRoundIcon aria-hidden />
        <span className="sr-only">{m.account_menu_label({ name })}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-72">
        <DropdownMenuGroup>
          {/* Wrapped, never truncated: on a phone this is the only place the full email and workspace show. */}
          <DropdownMenuLabel className="flex flex-col gap-0.5 pb-2 [overflow-wrap:anywhere]">
            <span className="text-sm text-foreground">{name}</span>
            <span className="font-normal">{email}</span>
            {workspace ? (
              <span className="mt-2 flex flex-col gap-0.5 border-t pt-2">
                <span>{m.workspace_label()}</span>
                <span className="text-sm font-normal text-foreground">{workspace}</span>
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void signOut()}>
            <LogOutIcon aria-hidden className="text-muted-foreground" />
            {m.sign_out()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two rank chevrons: a brigade's insignia, drawn in the brand hue. */
function BrigadeMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0 text-primary" fill="none">
      <path
        d="M4 12.5 12 6l8 6.5M4 19l8-6.5 8 6.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LanguageMenu() {
  const { locale, setLocale } = usePreferences();
  const signedIn = authClient.useSession().data != null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="max-sm:w-11 max-sm:px-0 sm:px-3" />}
      >
        <LanguagesIcon aria-hidden />
        {/* Icon-only on phones, like the theme menu, so the workspace name keeps the room; the accessible name
            still says which language is on: "Language: English" / "Idioma: Português (Brasil)". */}
        <span className="sr-only">{m.language_label()}: </span>
        <span className="max-sm:sr-only">{LANGUAGE_NAMES[locale]()}</span>
        <ChevronDownIcon aria-hidden className="text-muted-foreground max-sm:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.language_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              if (!isLocale(value)) return;
              setLocale(value);
              // Emails follow the dashboard's language (RFC 0008); the switch never waits for it.
              if (signedIn) void saveLocale(value);
            }}
          >
            {locales.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} lang={option} closeOnClick>
                {LANGUAGE_NAMES[option]()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = usePreferences();
  // The trigger shows what is on screen; the menu shows the choice (System, with its current look).
  const Icon = THEMES[resolvedTheme].icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="max-sm:w-11 max-sm:px-0 sm:px-3" />}
      >
        <Icon aria-hidden />
        <span className="sr-only">{m.theme_label()}: </span>
        <span className="max-sm:sr-only">{THEMES[theme].name()}</span>
        <ChevronDownIcon aria-hidden className="text-muted-foreground max-sm:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.theme_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => {
              if (isThemePreference(value)) setTheme(value);
            }}
          >
            {themePreferences.map((option) => {
              const OptionIcon = THEMES[option].icon;
              return (
                <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                  <OptionIcon aria-hidden className="text-muted-foreground" />
                  {THEMES[option].name()}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
