/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ max: NonNullable<unknown> }} Mobile_Instances_FullInputs */



/**
* | output |
* | --- |
* | "This phone has the most instances it can ({max}). Remove one to add another." |
*
* @param {Mobile_Instances_FullInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_instances_full = /** @type {((inputs: Mobile_Instances_FullInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Instances_FullInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Este telefone já tem o máximo de instâncias possível (${i?.max}). Remova uma para adicionar outra.`)
	return /** @type {LocalizedString} */ (`This phone has the most instances it can (${i?.max}). Remove one to add another.`)
});