/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Incidents_Hide_LowerInputs */



/**
* | output |
* | --- |
* | "Hide lower-severity incidents" |
*
* @param {Incidents_Hide_LowerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_hide_lower = /** @type {((inputs?: Incidents_Hide_LowerInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Hide_LowerInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ocultar incidentes de severidade menor")
	return /** @type {LocalizedString} */ ("Hide lower-severity incidents")
});