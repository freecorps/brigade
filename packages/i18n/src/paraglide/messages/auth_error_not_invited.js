/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Not_InvitedInputs */



/**
* | output |
* | --- |
* | "This address has no invitation. Sign up with the address the invitation was sent to." |
*
* @param {Auth_Error_Not_InvitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_not_invited = /** @type {((inputs?: Auth_Error_Not_InvitedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Not_InvitedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Este endereço não tem convite. Crie a conta com o endereço para o qual o convite foi enviado.")
	return /** @type {LocalizedString} */ ("This address has no invitation. Sign up with the address the invitation was sent to.")
});