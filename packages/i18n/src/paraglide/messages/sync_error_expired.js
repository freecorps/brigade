/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_ExpiredInputs */



/**
* | output |
* | --- |
* | "It waited too long to be sent and was dropped." |
*
* @param {Sync_Error_ExpiredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_expired = /** @type {((inputs?: Sync_Error_ExpiredInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ExpiredInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A alteração esperou demais para ser enviada e foi descartada.")
	return /** @type {LocalizedString} */ ("It waited too long to be sent and was dropped.")
});