/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mobile_Overview_DescriptionInputs */



/**
* | output |
* | --- |
* | "The severity and status legend, drawn from the shared tokens and catalog." |
*
* @param {Mobile_Overview_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_overview_description = /** @type {((inputs?: Mobile_Overview_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Overview_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A legenda de severidade e status, a partir dos tokens e do catálogo compartilhados.")
	return /** @type {LocalizedString} */ ("The severity and status legend, drawn from the shared tokens and catalog.")
});