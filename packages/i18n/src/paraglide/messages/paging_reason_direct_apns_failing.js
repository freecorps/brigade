/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Direct_Apns_FailingInputs */



/**
* | output |
* | --- |
* | "Apple's push service refused this instance's own key, or isn't answering. iPhones are paged through the push relay meanwhile." |
*
* @param {Paging_Reason_Direct_Apns_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_direct_apns_failing = /** @type {((inputs?: Paging_Reason_Direct_Apns_FailingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Direct_Apns_FailingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O serviço de push da Apple recusou a chave própria desta instância, ou não está respondendo. Enquanto isso, iPhones são acionados pelo relay de push.")
	return /** @type {LocalizedString} */ ("Apple's push service refused this instance's own key, or isn't answering. iPhones are paged through the push relay meanwhile.")
});