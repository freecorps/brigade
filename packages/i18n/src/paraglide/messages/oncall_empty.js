/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_EmptyInputs */



/**
* | output |
* | --- |
* | "No on-call schedules yet. A schedule says who is on call and when they hand off." |
*
* @param {Oncall_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_empty = /** @type {((inputs?: Oncall_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ainda não há escalas de plantão. Uma escala diz quem está de plantão e quando passa o turno.")
	return /** @type {LocalizedString} */ ("No on-call schedules yet. A schedule says who is on call and when they hand off.")
});