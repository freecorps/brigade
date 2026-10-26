/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Edit_LabelInputs */



/**
* | output |
* | --- |
* | "Edit {name}" |
*
* @param {Oncall_Edit_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_edit_label = /** @type {((inputs: Oncall_Edit_LabelInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Edit_LabelInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Editar ${i?.name}`)
	return /** @type {LocalizedString} */ (`Edit ${i?.name}`)
});