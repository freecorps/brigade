/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_UnknownInputs */



/**
* | output |
* | --- |
* | "The paging self-check hasn't run yet. Once it runs, a test page goes through Brigade every minute." |
*
* @param {Paging_UnknownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_unknown = /** @type {((inputs?: Paging_UnknownInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnknownInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A autoverificação dos acionamentos ainda não rodou. Quando rodar, um acionamento de teste passa pelo Brigade a cada minuto.")
	return /** @type {LocalizedString} */ ("The paging self-check hasn't run yet. Once it runs, a test page goes through Brigade every minute.")
});