// What the engine provides on its own, measured before any polyfill loads. Imported first by
// src/intl/setup.ts, so module order is what makes this "native".
import { probeIntl } from "./probe";

export const nativeIntl = probeIntl();
