// Hermes (React Native 0.88, Static Hermes) has no Intl.PluralRules, Intl.RelativeTimeFormat or
// Intl.Locale; DateTimeFormat (with dateStyle/timeStyle and time zones) and NumberFormat are native.
// Without PluralRules every plural message (incidents_active_count) throws while rendering.
// Results: docs/spikes/s4-expo-workspace.md.
//
// Each `polyfill.js` installs itself only when the engine lacks the feature, so an engine that ships
// it later keeps its own. Order matters: Locale needs getCanonicalLocales; PluralRules needs Locale;
// RelativeTimeFormat needs both. Only `en` and `pt` (which is pt-BR in CLDR) data are bundled.
import "@formatjs/intl-getcanonicallocales/polyfill.js";
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-relativetimeformat/polyfill.js";
import "@formatjs/intl-relativetimeformat/locale-data/en.js";
import "@formatjs/intl-relativetimeformat/locale-data/pt.js";
