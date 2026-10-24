/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} App_TaglineInputs */



/**
* | output |
* | --- |
* | "Open-source incident management that deploys to your Cloudflare account." |
*
* @param {App_TaglineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const app_tagline = /** @type {((inputs?: App_TaglineInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<App_TaglineInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Gestão de incidentes open source que roda na sua conta da Cloudflare.")
	return /** @type {LocalizedString} */ ("Open-source incident management that deploys to your Cloudflare account.")
});