/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Error_NetworkInputs */



/**
* | output |
* | --- |
* | "The request to /api never got an answer." |
*
* @param {Stack_Error_NetworkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_error_network = /** @type {((inputs?: Stack_Error_NetworkInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_NetworkInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A requisição para /api ficou sem resposta.")
	return /** @type {LocalizedString} */ ("The request to /api never got an answer.")
});