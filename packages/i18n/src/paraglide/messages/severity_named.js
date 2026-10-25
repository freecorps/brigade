/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ code: NonNullable<unknown>, name: NonNullable<unknown> }} Severity_NamedInputs */



/**
* | output |
* | --- |
* | "{code} {name}" |
*
* @param {Severity_NamedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const severity_named = /** @type {((inputs: Severity_NamedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Severity_NamedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`${i?.code} ${i?.name}`)
	return /** @type {LocalizedString} */ (`${i?.code} ${i?.name}`)
});