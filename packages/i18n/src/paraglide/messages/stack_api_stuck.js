/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Api_StuckInputs */



/**
* | output |
* | --- |
* | "The API Worker is not answering in time" |
*
* @param {Stack_Api_StuckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_api_stuck = /** @type {((inputs?: Stack_Api_StuckInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Api_StuckInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O Worker da API não está respondendo a tempo")
	return /** @type {LocalizedString} */ ("The API Worker is not answering in time")
});