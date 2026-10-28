/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Sign_Up_Closed_TitleInputs */



/**
* | output |
* | --- |
* | "Sign-up is closed" |
*
* @param {Auth_Sign_Up_Closed_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_sign_up_closed_title = /** @type {((inputs?: Auth_Sign_Up_Closed_TitleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Sign_Up_Closed_TitleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Cadastro fechado")
	return /** @type {LocalizedString} */ ("Sign-up is closed")
});