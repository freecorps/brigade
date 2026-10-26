/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Override_Add_LabelInputs */



/**
* | output |
* | --- |
* | "Add override to {name}" |
*
* @param {Oncall_Override_Add_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_override_add_label = /** @type {((inputs: Oncall_Override_Add_LabelInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_Add_LabelInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Adicionar substituição em ${i?.name}`)
	return /** @type {LocalizedString} */ (`Add override to ${i?.name}`)
});