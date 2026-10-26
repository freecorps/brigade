/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Oncall_Handoff_DailyInputs */



/**
* | output |
* | --- |
* | "hands off at {time}" |
*
* @param {Oncall_Handoff_DailyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_handoff_daily = /** @type {((inputs: Oncall_Handoff_DailyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Handoff_DailyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`troca às ${i?.time}`)
	return /** @type {LocalizedString} */ (`hands off at ${i?.time}`)
});