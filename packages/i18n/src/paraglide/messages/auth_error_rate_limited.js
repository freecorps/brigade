/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Rate_LimitedInputs */



/**
* | output |
* | --- |
* | "Too many attempts. Wait a minute and try again." |
*
* @param {Auth_Error_Rate_LimitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_rate_limited = /** @type {((inputs?: Auth_Error_Rate_LimitedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Rate_LimitedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Muitas tentativas. Aguarde um minuto e tente de novo.")
	return /** @type {LocalizedString} */ ("Too many attempts. Wait a minute and try again.")
});