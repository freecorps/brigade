/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Overview_DescriptionInputs */



/**
* | output |
* | --- |
* | "The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine." |
*
* @param {Overview_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const overview_description = /** @type {((inputs?: Overview_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O painel, o Worker dele, o Worker da API e um Durable Object, tudo rodando na sua máquina.")
	return /** @type {LocalizedString} */ ("The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine.")
});