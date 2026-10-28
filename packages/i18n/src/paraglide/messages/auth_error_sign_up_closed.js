/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Sign_Up_ClosedInputs */



/**
* | output |
* | --- |
* | "Sign-up is closed on this instance — ask an owner for an invitation." |
*
* @param {Auth_Error_Sign_Up_ClosedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_sign_up_closed = /** @type {((inputs?: Auth_Error_Sign_Up_ClosedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Sign_Up_ClosedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O cadastro está fechado nesta instância — peça um convite a um proprietário.")
	return /** @type {LocalizedString} */ ("Sign-up is closed on this instance — ask an owner for an invitation.")
});