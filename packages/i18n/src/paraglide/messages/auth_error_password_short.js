/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_Password_ShortInputs */



/**
* | output |
* | --- |
* | "Use at least 8 characters." |
*
* @param {Auth_Error_Password_ShortInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_password_short = /** @type {((inputs?: Auth_Error_Password_ShortInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Password_ShortInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Use pelo menos 8 caracteres.")
	return /** @type {LocalizedString} */ ("Use at least 8 characters.")
});