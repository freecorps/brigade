/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Stack_Checked_AtInputs */



/**
* | output |
* | --- |
* | "Checked at {time}" |
*
* @param {Stack_Checked_AtInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_checked_at = /** @type {((inputs: Stack_Checked_AtInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Checked_AtInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Verificado às ${i?.time}`)
	return /** @type {LocalizedString} */ (`Checked at ${i?.time}`)
});