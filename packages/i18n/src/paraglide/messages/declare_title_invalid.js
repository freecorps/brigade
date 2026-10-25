/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Declare_Title_InvalidInputs */



/**
* | output |
* | --- |
* | "Enter a title. Invisible characters alone don't count." |
*
* @param {Declare_Title_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const declare_title_invalid = /** @type {((inputs?: Declare_Title_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Digite um título. Só caracteres invisíveis não contam.")
	return /** @type {LocalizedString} */ ("Enter a title. Invisible characters alone don't count.")
});