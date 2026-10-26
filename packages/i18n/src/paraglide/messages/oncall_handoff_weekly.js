/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ day: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_Handoff_WeeklyInputs */



/**
* | output |
* | --- |
* | "hands off {day} at {time}" |
*
* @param {Oncall_Handoff_WeeklyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_handoff_weekly = /** @type {((inputs: Oncall_Handoff_WeeklyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Handoff_WeeklyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`troca ${i?.day}, às ${i?.time}`)
	return /** @type {LocalizedString} */ (`hands off ${i?.day} at ${i?.time}`)
});