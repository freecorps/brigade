/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Sign_Up_Invite_OnlyInputs */



/**
* | output |
* | --- |
* | "Only an address with a pending invitation can create an account here." |
*
* @param {Auth_Sign_Up_Invite_OnlyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_sign_up_invite_only = /** @type {((inputs?: Auth_Sign_Up_Invite_OnlyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Invite_OnlyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Aqui, só um endereço com convite pendente pode criar uma conta.")
	return /** @type {LocalizedString} */ ("Only an address with a pending invitation can create an account here.")
});