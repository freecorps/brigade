/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_ForbiddenInputs */



/**
* | output |
* | --- |
* | "You don't have permission to do that." |
*
* @param {Sync_Error_ForbiddenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_forbidden = /** @type {((inputs?: Sync_Error_ForbiddenInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ForbiddenInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Você não tem permissão para fazer isso.")
	return /** @type {LocalizedString} */ ("You don't have permission to do that.")
});