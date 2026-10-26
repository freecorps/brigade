/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Upcoming_NoneInputs */



/**
* | output |
* | --- |
* | "No handoffs in the next 4 weeks" |
*
* @param {Oncall_Upcoming_NoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_upcoming_none = /** @type {((inputs?: Oncall_Upcoming_NoneInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Upcoming_NoneInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nenhuma troca nas próximas 4 semanas")
	return /** @type {LocalizedString} */ ("No handoffs in the next 4 weeks")
});