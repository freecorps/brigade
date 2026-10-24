import { isLocale, locales, m, type Locale } from "@freecorps/brigade-i18n";
import { Link } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="-mx-2 flex h-11 items-center gap-2 rounded-md px-2 text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <BrigadeMark />
          {m.app_name()}
        </Link>
        <span className="hidden h-6 items-center rounded-sm bg-muted px-2 text-xs font-medium text-muted-foreground sm:inline-flex">
          {m.environment_local()}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <LanguageMenu />
          <ThemeMenu />
        </div>
      </div>
    </header>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="px-3" />}>
        <LanguagesIcon aria-hidden />
        {/* The accessible name contains the visible text: "Language: EN" / "Language: English". */}
        <span className="sr-only">{m.language_label()}: </span>
        <span className="sm:hidden">{locale.split("-")[0]?.toUpperCase()}</span>
        <span className="max-sm:hidden">{LANGUAGE_NAMES[locale]()}</span>
        <ChevronDownIcon aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.language_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              if (isLocale(value)) setLocale(value);
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
