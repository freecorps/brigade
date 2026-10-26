/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Oncall_UntilInputs */



/**
* | output |
* | --- |
* | "until {time}" |
*
* @param {Oncall_UntilInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_until = /** @type {((inputs: Oncall_UntilInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UntilInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`até ${i?.time}`)
	return /** @type {LocalizedString} */ (`until ${i?.time}`)
});