/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Hint_DoInputs */



/**
* | output |
* | --- |
* | "The API is up. Look for the error in the terminal running:" |
*
* @param {Stack_Hint_DoInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_hint_do = /** @type {((inputs?: Stack_Hint_DoInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_DoInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A API está no ar. Procure o erro no terminal que está rodando:")
	return /** @type {LocalizedString} */ ("The API is up. Look for the error in the terminal running:")
});