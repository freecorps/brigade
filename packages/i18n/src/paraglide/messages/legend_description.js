/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Legend_DescriptionInputs */



/**
* | output |
* | --- |
* | "How incidents are marked across Brigade. The code or the name always travels with the colour." |
*
* @param {Legend_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const legend_description = /** @type {((inputs?: Legend_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Legend_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Como os incidentes são marcados no Brigade. O código ou o nome sempre acompanha a cor.")
	return /** @type {LocalizedString} */ ("How incidents are marked across Brigade. The code or the name always travels with the colour.")
});