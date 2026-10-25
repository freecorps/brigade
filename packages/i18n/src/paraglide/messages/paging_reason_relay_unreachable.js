/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_UnreachableInputs */



/**
* | output |
* | --- |
* | "The push relay isn't answering." |
*
* @param {Paging_Reason_Relay_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_unreachable = /** @type {((inputs?: Paging_Reason_Relay_UnreachableInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_UnreachableInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push não está respondendo.")
	return /** @type {LocalizedString} */ ("The push relay isn't answering.")
});