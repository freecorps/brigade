/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Not_InvitedInputs */



/**
* | output |
* | --- |
* | "This address has no open invitation. Sign up with the address the invitation was sent to, or ask an owner to send it again if it ran out." |
*
* @param {Auth_Error_Not_InvitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_not_invited = /** @type {((inputs?: Auth_Error_Not_InvitedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Not_InvitedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Este endereço não tem um convite em aberto. Crie a conta com o endereço para o qual o convite foi enviado ou, se ele expirou, peça a um proprietário para enviá-lo de novo.")
	return /** @type {LocalizedString} */ ("This address has no open invitation. Sign up with the address the invitation was sent to, or ask an owner to send it again if it ran out.")
});