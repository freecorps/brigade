/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Fallback_BodyInputs */



/**
* | output |
* | --- |
* | "Open Brigade to see it." |
*
* @param {Push_Fallback_BodyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_fallback_body = /** @type {((inputs?: Push_Fallback_BodyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Fallback_BodyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Abra o Brigade para ver.")
	return /** @type {LocalizedString} */ ("Open Brigade to see it.")
});