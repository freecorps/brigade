/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Error_UnreachableInputs */



/**
* | output |
* | --- |
* | "The web Worker couldn't reach the API Worker." |
*
* @param {Stack_Error_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_error_unreachable = /** @type {((inputs?: Stack_Error_UnreachableInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_UnreachableInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O Worker web não conseguiu acessar o Worker da API.")
	return /** @type {LocalizedString} */ ("The web Worker couldn't reach the API Worker.")
});