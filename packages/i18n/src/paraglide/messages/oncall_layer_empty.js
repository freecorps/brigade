/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Layer_EmptyInputs */



/**
* | output |
* | --- |
* | "Nobody in this layer: a gap until someone is added" |
*
* @param {Oncall_Layer_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layer_empty = /** @type {((inputs?: Oncall_Layer_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ninguém nesta camada: um buraco até alguém ser adicionado")
	return /** @type {LocalizedString} */ ("Nobody in this layer: a gap until someone is added")
});