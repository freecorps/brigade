/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ max: NonNullable<unknown> }} Oncall_Count_InvalidInputs */



/**
* | output |
* | --- |
* | "Enter a whole number from 1 to {max}." |
*
* @param {Oncall_Count_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_count_invalid = /** @type {((inputs: Oncall_Count_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Count_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Informe um número inteiro de 1 a ${i?.max}.`)
	return /** @type {LocalizedString} */ (`Enter a whole number from 1 to ${i?.max}.`)
});