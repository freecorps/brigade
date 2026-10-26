/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Override_StartInputs */



/**
* | output |
* | --- |
* | "From" |
*
* @param {Oncall_Override_StartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_override_start = /** @type {((inputs?: Oncall_Override_StartInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_StartInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("De")
	return /** @type {LocalizedString} */ ("From")
});