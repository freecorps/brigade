/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Widget_On_Call_InInputs */



/**
* | output |
* | --- |
* | "On call in {name}" |
*
* @param {Widget_On_Call_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_on_call_in = /** @type {((inputs: Widget_On_Call_InInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_On_Call_InInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`De plantão em ${i?.name}`)
	return /** @type {LocalizedString} */ (`On call in ${i?.name}`)
});