/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ number: NonNullable<unknown> }} Oncall_Layer_NameInputs */



/**
* | number | output |
* | --- | --- |
* | "1" | "Primary" |
* | * | "Layer {number}" |
*
* @param {Oncall_Layer_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layer_name = /** @type {((inputs: Oncall_Layer_NameInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NameInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if ((i?.number === 1 || i?.number === "1")) return /** @type {LocalizedString} */ (`Principal`);
		return /** @type {LocalizedString} */ (`Camada ${i?.number}`)
	}
	{
		if ((i?.number === 1 || i?.number === "1")) return /** @type {LocalizedString} */ (`Primary`);
		return /** @type {LocalizedString} */ (`Layer ${i?.number}`)
	}
});