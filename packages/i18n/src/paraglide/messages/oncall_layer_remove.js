/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Layer_RemoveInputs */



/**
* | output |
* | --- |
* | "Remove layer {name}" |
*
* @param {Oncall_Layer_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layer_remove = /** @type {((inputs: Oncall_Layer_RemoveInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_RemoveInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Remover a camada ${i?.name}`)
	return /** @type {LocalizedString} */ (`Remove layer ${i?.name}`)
});