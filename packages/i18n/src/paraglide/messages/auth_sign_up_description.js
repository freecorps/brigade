/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Sign_Up_DescriptionInputs */



/**
* | output |
* | --- |
* | "You will own a new workspace. Invite your team once it is set up." |
*
* @param {Auth_Sign_Up_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_sign_up_description = /** @type {((inputs?: Auth_Sign_Up_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Você será o dono de um novo espaço de trabalho. Convide seu time depois de configurar.")
	return /** @type {LocalizedString} */ ("You will own a new workspace. Invite your team once it is set up.")
});