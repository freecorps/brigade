/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Hint_Api_ErrorInputs */



/**
* | output |
* | --- |
* | "The API answered with an error. Look for it in the terminal running:" |
*
* @param {Stack_Hint_Api_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_hint_api_error = /** @type {((inputs?: Stack_Hint_Api_ErrorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_Api_ErrorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A API respondeu com erro. Procure o erro no terminal que está rodando:")
	return /** @type {LocalizedString} */ ("The API answered with an error. Look for it in the terminal running:")
});