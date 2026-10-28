/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Fcm_FailingInputs */



/**
* | output |
* | --- |
* | "Firebase Cloud Messaging gave the relay no access token." |
*
* @param {Paging_Reason_Fcm_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_fcm_failing = /** @type {((inputs?: Paging_Reason_Fcm_FailingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Fcm_FailingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O Firebase Cloud Messaging não deu um token de acesso ao relay.")
	return /** @type {LocalizedString} */ ("Firebase Cloud Messaging gave the relay no access token.")
});