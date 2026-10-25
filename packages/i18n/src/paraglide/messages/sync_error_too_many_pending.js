/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Too_Many_PendingInputs */



/**
* | output |
* | --- |
* | "Wait for the pending changes to be sent, then try again." |
*
* @param {Sync_Error_Too_Many_PendingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_too_many_pending = /** @type {((inputs?: Sync_Error_Too_Many_PendingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Too_Many_PendingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Espere as alterações pendentes serem enviadas e tente de novo.")
	return /** @type {LocalizedString} */ ("Wait for the pending changes to be sent, then try again.")
});