/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mobile_Sync_RetryingInputs */



/**
* | output |
* | --- |
* | "The app keeps trying on its own." |
*
* @param {Mobile_Sync_RetryingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_sync_retrying = /** @type {((inputs?: Mobile_Sync_RetryingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Sync_RetryingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O app continua tentando sozinho.")
	return /** @type {LocalizedString} */ ("The app keeps trying on its own.")
});