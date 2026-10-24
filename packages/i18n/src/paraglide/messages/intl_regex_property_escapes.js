/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Intl_Regex_Property_EscapesInputs */



/**
* | output |
* | --- |
* | "Regex property escapes" |
*
* @param {Intl_Regex_Property_EscapesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const intl_regex_property_escapes = /** @type {((inputs?: Intl_Regex_Property_EscapesInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Regex_Property_EscapesInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Escapes de propriedade Unicode em regex")
	return /** @type {LocalizedString} */ ("Regex property escapes")
});