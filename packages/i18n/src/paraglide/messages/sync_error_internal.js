/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_InternalInputs */



/**
* | output |
* | --- |
* | "Something went wrong on the server. Try again." |
*
* @param {Sync_Error_InternalInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_internal = /** @type {((inputs?: Sync_Error_InternalInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_InternalInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Algo deu errado no servidor. Tente de novo.")
	return /** @type {LocalizedString} */ ("Something went wrong on the server. Try again.")
});