/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ max: NonNullable<unknown> }} Oncall_Override_Member_LimitInputs */



/**
* | output |
* | --- |
* | "This person already has {max} upcoming overrides on this schedule, the most one person can have. Remove one first." |
*
* @param {Oncall_Override_Member_LimitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_override_member_limit = /** @type {((inputs: Oncall_Override_Member_LimitInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_Member_LimitInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Essa pessoa já tem ${i?.max} substituições futuras nesta escala, o máximo para uma pessoa. Remova uma antes.`)
	return /** @type {LocalizedString} */ (`This person already has ${i?.max} upcoming overrides on this schedule, the most one person can have. Remove one first.`)
});