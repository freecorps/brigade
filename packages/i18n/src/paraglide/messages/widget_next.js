/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Widget_NextInputs */



/**
* | output |
* | --- |
* | "Next shift {time}" |
*
* @param {Widget_NextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_next = /** @type {((inputs: Widget_NextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_NextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Próximo turno ${i?.time}`)
	return /** @type {LocalizedString} */ (`Next shift ${i?.time}`)
});