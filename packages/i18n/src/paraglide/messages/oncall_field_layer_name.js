/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Field_Layer_NameInputs */



/**
* | output |
* | --- |
* | "Layer name" |
*
* @param {Oncall_Field_Layer_NameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_field_layer_name = /** @type {((inputs?: Oncall_Field_Layer_NameInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_Layer_NameInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nome da camada")
	return /** @type {LocalizedString} */ ("Layer name")
});