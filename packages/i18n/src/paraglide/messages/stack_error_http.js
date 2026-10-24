/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ status: NonNullable<unknown> }} Stack_Error_HttpInputs */



/**
* | output |
* | --- |
* | "The API answered with HTTP {status}." |
*
* @param {Stack_Error_HttpInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_error_http = /** @type {((inputs: Stack_Error_HttpInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_HttpInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`A API respondeu com HTTP ${i?.status}.`)
	return /** @type {LocalizedString} */ (`The API answered with HTTP ${i?.status}.`)
});