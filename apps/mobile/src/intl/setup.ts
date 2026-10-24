// Loaded first by the root layout, before packages/i18n formats anything. Import order is the point:
// measure the engine, then polyfill what it lacks, then measure again.
import "./native";
import "./polyfills";
import { probeIntl } from "./probe";

/** What the engine provides once the polyfills have loaded. */
export const currentIntl = probeIntl();
