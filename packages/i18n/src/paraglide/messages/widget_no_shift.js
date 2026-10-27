/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Widget_No_ShiftInputs */



/**
* | output |
* | --- |
* | "No shift in the next 4 weeks" |
*
* @param {Widget_No_ShiftInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_no_shift = /** @type {((inputs?: Widget_No_ShiftInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_No_ShiftInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Sem plantão nas próximas 4 semanas")
	return /** @type {LocalizedString} */ ("No shift in the next 4 weeks")
});