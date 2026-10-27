/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Widget_No_SchedulesInputs */



/**
* | output |
* | --- |
* | "No on-call schedules" |
*
* @param {Widget_No_SchedulesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_no_schedules = /** @type {((inputs?: Widget_No_SchedulesInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_No_SchedulesInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nenhuma escala de plantão")
	return /** @type {LocalizedString} */ ("No on-call schedules")
});