/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Escalation_Policy_NamedInputs */



/**
* | output |
* | --- |
* | "Policy: {name}" |
*
* @param {Escalation_Policy_NamedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_policy_named = /** @type {((inputs: Escalation_Policy_NamedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Policy_NamedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Política: ${i?.name}`)
	return /** @type {LocalizedString} */ (`Policy: ${i?.name}`)
});