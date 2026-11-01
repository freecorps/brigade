/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Bad_SignatureInputs */



/**
* | output |
* | --- |
* | "The push relay refused this instance's key (RELAY_INSTANCE_KEY), so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Bad_SignatureInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_bad_signature = /** @type {((inputs?: Paging_Reason_Relay_Bad_SignatureInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Bad_SignatureInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push recusou a chave desta instância (RELAY_INSTANCE_KEY), então celulares registrados pelo relay não podem ser acionados.")
	return /** @type {LocalizedString} */ ("The push relay refused this instance's key (RELAY_INSTANCE_KEY), so phones registered through the relay can't be paged.")
});