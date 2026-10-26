/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Email_Not_VerifiedInputs */



/**
* | output |
* | --- |
* | "Confirm your email first: open the link Brigade sent you, then sign in." |
*
* @param {Auth_Error_Email_Not_VerifiedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_email_not_verified = /** @type {((inputs?: Auth_Error_Email_Not_VerifiedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Email_Not_VerifiedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Confirme seu email primeiro: abra o link que o Brigade enviou e depois entre.")
	return /** @type {LocalizedString} */ ("Confirm your email first: open the link Brigade sent you, then sign in.")
});