/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ zone: NonNullable<unknown>, offset: NonNullable<unknown> }} Oncall_Time_ZoneInputs */



/**
* | output |
* | --- |
* | "Times in {zone} ({offset})" |
*
* @param {Oncall_Time_ZoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_time_zone = /** @type {((inputs: Oncall_Time_ZoneInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Time_ZoneInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Horários em ${i?.zone} (${i?.offset})`)
	return /** @type {LocalizedString} */ (`Times in ${i?.zone} (${i?.offset})`)
});