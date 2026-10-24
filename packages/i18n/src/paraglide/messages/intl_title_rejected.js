/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Intl_Title_RejectedInputs */



/**
* | output |
* | --- |
* | "Rejected" |
*
* @param {Intl_Title_RejectedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const intl_title_rejected = /** @type {((inputs?: Intl_Title_RejectedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Title_RejectedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Rejeitado")
	return /** @type {LocalizedString} */ ("Rejected")
});