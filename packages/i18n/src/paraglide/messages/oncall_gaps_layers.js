/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ layers: NonNullable<unknown> }} Oncall_Gaps_LayersInputs */



/**
* | output |
* | --- |
* | "Nobody in {layers}" |
*
* @param {Oncall_Gaps_LayersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_gaps_layers = /** @type {((inputs: Oncall_Gaps_LayersInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_LayersInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Ninguém em ${i?.layers}`)
	return /** @type {LocalizedString} */ (`Nobody in ${i?.layers}`)
});