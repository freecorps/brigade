/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Intl_Title_AcceptedInputs */



/**
* | output |
* | --- |
* | "Accepted" |
*
* @param {Intl_Title_AcceptedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const intl_title_accepted = /** @type {((inputs?: Intl_Title_AcceptedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_Title_AcceptedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Aceito")
	return /** @type {LocalizedString} */ ("Accepted")
});