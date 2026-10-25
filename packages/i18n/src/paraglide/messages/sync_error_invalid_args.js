/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Invalid_ArgsInputs */



/**
* | output |
* | --- |
* | "Check what you typed and try again." |
*
* @param {Sync_Error_Invalid_ArgsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_invalid_args = /** @type {((inputs?: Sync_Error_Invalid_ArgsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Invalid_ArgsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Confira o que você digitou e tente de novo.")
	return /** @type {LocalizedString} */ ("Check what you typed and try again.")
});