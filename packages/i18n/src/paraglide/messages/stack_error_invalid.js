/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Error_InvalidInputs */



/**
* | output |
* | --- |
* | "The API answered, but not with the data the dashboard expects." |
*
* @param {Stack_Error_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_error_invalid = /** @type {((inputs?: Stack_Error_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A API respondeu, mas não com os dados que o painel espera.")
	return /** @type {LocalizedString} */ ("The API answered, but not with the data the dashboard expects.")
});