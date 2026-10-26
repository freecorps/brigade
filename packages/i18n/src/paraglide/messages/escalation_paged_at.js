/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Escalation_Paged_AtInputs */



/**
* | output |
* | --- |
* | "Paged {time}" |
*
* @param {Escalation_Paged_AtInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_paged_at = /** @type {((inputs: Escalation_Paged_AtInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Paged_AtInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Chamado ${i?.time}`)
	return /** @type {LocalizedString} */ (`Paged ${i?.time}`)
});