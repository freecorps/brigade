/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Language_Name_Pt_BrInputs */



/**
* | output |
* | --- |
* | "Português (Brasil)" |
*
* @param {Language_Name_Pt_BrInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const language_name_pt_br = /** @type {((inputs?: Language_Name_Pt_BrInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Language_Name_Pt_BrInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Português (Brasil)")
	return /** @type {LocalizedString} */ ("Português (Brasil)")
});