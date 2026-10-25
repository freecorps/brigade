/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_NetworkInputs */



/**
* | output |
* | --- |
* | "Could not reach Brigade. Check your connection and try again." |
*
* @param {Auth_Error_NetworkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_network = /** @type {((inputs?: Auth_Error_NetworkInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_NetworkInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível falar com o Brigade. Verifique sua conexão e tente de novo.")
	return /** @type {LocalizedString} */ ("Could not reach Brigade. Check your connection and try again.")
});