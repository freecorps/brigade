/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ number: NonNullable<unknown> }} Oncall_Layer_NumberedInputs */



/**
* | output |
* | --- |
* | "Layer {number}" |
*
* @param {Oncall_Layer_NumberedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layer_numbered = /** @type {((inputs: Oncall_Layer_NumberedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NumberedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Camada ${i?.number}`)
	return /** @type {LocalizedString} */ (`Layer ${i?.number}`)
});