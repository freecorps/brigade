/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Allow_Full_ScreenInputs */



/**
* | output |
* | --- |
* | "Allow full-screen alerts" |
*
* @param {Call_Allow_Full_ScreenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_allow_full_screen = /** @type {((inputs?: Call_Allow_Full_ScreenInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Allow_Full_ScreenInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Permitir alertas em tela cheia")
	return /** @type {LocalizedString} */ ("Allow full-screen alerts")
});