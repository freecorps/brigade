/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Email_TakenInputs */



/**
* | output |
* | --- |
* | "An account with this email already exists. Sign in instead." |
*
* @param {Auth_Error_Email_TakenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_email_taken = /** @type {((inputs?: Auth_Error_Email_TakenInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Email_TakenInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Já existe uma conta com este e-mail. Entre com ela.")
	return /** @type {LocalizedString} */ ("An account with this email already exists. Sign in instead.")
});