/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_UnreachableInputs */



/**
* | output |
* | --- |
* | "Couldn't check whether pages get through" |
*
* @param {Paging_UnreachableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_unreachable = /** @type {((inputs?: Paging_UnreachableInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnreachableInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível verificar se os acionamentos estão saindo")
	return /** @type {LocalizedString} */ ("Couldn't check whether pages get through")
});