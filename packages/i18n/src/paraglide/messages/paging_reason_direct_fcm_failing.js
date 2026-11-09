/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Direct_Fcm_FailingInputs */



/**
* | output |
* | --- |
* | "Google refused this instance's own Firebase service account, or isn't answering. Android phones are paged through the push relay meanwhile." |
*
* @param {Paging_Reason_Direct_Fcm_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_direct_fcm_failing = /** @type {((inputs?: Paging_Reason_Direct_Fcm_FailingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Direct_Fcm_FailingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O Google recusou a conta de serviço do Firebase própria desta instância, ou não está respondendo. Enquanto isso, celulares Android são acionados pelo relay de push.")
	return /** @type {LocalizedString} */ ("Google refused this instance's own Firebase service account, or isn't answering. Android phones are paged through the push relay meanwhile.")
});