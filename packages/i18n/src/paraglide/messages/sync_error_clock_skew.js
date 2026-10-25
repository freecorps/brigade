/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Clock_SkewInputs */



/**
* | output |
* | --- |
* | "Your device clock is ahead of the server. Fix the date and time and try again." |
*
* @param {Sync_Error_Clock_SkewInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_clock_skew = /** @type {((inputs?: Sync_Error_Clock_SkewInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Clock_SkewInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relógio do seu dispositivo está adiantado em relação ao servidor. Corrija a data e a hora e tente de novo.")
	return /** @type {LocalizedString} */ ("Your device clock is ahead of the server. Fix the date and time and try again.")
});