/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Incidents_All_Clear_TitleInputs */



/**
* | output |
* | --- |
* | "All clear" |
*
* @param {Incidents_All_Clear_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_all_clear_title = /** @type {((inputs?: Incidents_All_Clear_TitleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_All_Clear_TitleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Tudo tranquilo")
	return /** @type {LocalizedString} */ ("All clear")
});