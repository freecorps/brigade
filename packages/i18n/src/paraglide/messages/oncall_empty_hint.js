/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Empty_HintInputs */



/**
* | output |
* | --- |
* | "A schedule says who is on call and when they hand off." |
*
* @param {Oncall_Empty_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_empty_hint = /** @type {((inputs?: Oncall_Empty_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Empty_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Uma escala diz quem está de plantão e quando passa o turno.")
	return /** @type {LocalizedString} */ ("A schedule says who is on call and when they hand off.")
});