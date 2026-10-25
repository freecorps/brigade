/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Auth_Error_EmailInputs */



/**
* | output |
* | --- |
* | "Enter an email address like name@example.com." |
*
* @param {Auth_Error_EmailInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_email = /** @type {((inputs?: Auth_Error_EmailInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_EmailInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Digite um e-mail como nome@exemplo.com.")
	return /** @type {LocalizedString} */ ("Enter an email address like name@example.com.")
});