/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Field_Handoff_TimeInputs */



/**
* | output |
* | --- |
* | "Handoff time" |
*
* @param {Oncall_Field_Handoff_TimeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_field_handoff_time = /** @type {((inputs?: Oncall_Field_Handoff_TimeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_Handoff_TimeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Horário da troca")
	return /** @type {LocalizedString} */ ("Handoff time")
});