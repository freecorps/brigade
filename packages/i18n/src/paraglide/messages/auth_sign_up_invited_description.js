/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Sign_Up_Invited_DescriptionInputs */



/**
* | output |
* | --- |
* | "Use the address the invitation was sent to. After you confirm it, you can accept the invitation." |
*
* @param {Auth_Sign_Up_Invited_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_sign_up_invited_description = /** @type {((inputs?: Auth_Sign_Up_Invited_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Invited_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Use o endereço para o qual o convite foi enviado. Depois de confirmá-lo, você pode aceitar o convite.")
	return /** @type {LocalizedString} */ ("Use the address the invitation was sent to. After you confirm it, you can accept the invitation.")
});