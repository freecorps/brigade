/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Hint_Api_StuckInputs */



/**
* | output |
* | --- |
* | "The API looks like it is running but stuck. Look in the terminal running:" |
*
* @param {Stack_Hint_Api_StuckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_hint_api_stuck = /** @type {((inputs?: Stack_Hint_Api_StuckInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_Api_StuckInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A API parece estar rodando, mas travada. Procure no terminal que está rodando:")
	return /** @type {LocalizedString} */ ("The API looks like it is running but stuck. Look in the terminal running:")
});