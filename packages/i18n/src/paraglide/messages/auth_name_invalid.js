/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Name_InvalidInputs */



/**
* | output |
* | --- |
* | "Remove invisible, control or bidi characters from the name." |
*
* @param {Auth_Name_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_name_invalid = /** @type {((inputs?: Auth_Name_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Name_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Remova caracteres invisíveis, de controle ou bidi do nome.")
	return /** @type {LocalizedString} */ ("Remove invisible, control or bidi characters from the name.")
});