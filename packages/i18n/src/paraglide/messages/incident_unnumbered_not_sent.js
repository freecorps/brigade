/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Incident_Unnumbered_Not_SentInputs */



/**
* | output |
* | --- |
* | "Not sent" |
*
* @param {Incident_Unnumbered_Not_SentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_unnumbered_not_sent = /** @type {((inputs?: Incident_Unnumbered_Not_SentInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Unnumbered_Not_SentInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Pendente")
	return /** @type {LocalizedString} */ ("Not sent")
});