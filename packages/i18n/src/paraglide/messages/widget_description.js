/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Widget_DescriptionInputs */



/**
* | output |
* | --- |
* | "Whether you're on call, until when, and your next shift." |
*
* @param {Widget_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_description = /** @type {((inputs?: Widget_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Se você está de plantão, até quando e seu próximo turno.")
	return /** @type {LocalizedString} */ ("Whether you're on call, until when, and your next shift.")
});