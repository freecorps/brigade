/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Schedule_AddInputs */



/**
* | output |
* | --- |
* | "Add schedule" |
*
* @param {Oncall_Schedule_AddInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_schedule_add = /** @type {((inputs?: Oncall_Schedule_AddInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Schedule_AddInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Adicionar escala")
	return /** @type {LocalizedString} */ ("Add schedule")
});