/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Too_Many_PendingInputs */



/**
* | output |
* | --- |
* | "Too many changes are waiting to be sent. Try again once you're back online." |
*
* @param {Sync_Error_Too_Many_PendingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_too_many_pending = /** @type {((inputs?: Sync_Error_Too_Many_PendingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Too_Many_PendingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Há alterações demais esperando envio. Tente de novo quando estiver online.")
	return /** @type {LocalizedString} */ ("Too many changes are waiting to be sent. Try again once you're back online.")
});