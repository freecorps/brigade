/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_UnavailableInputs */



/**
* | output |
* | --- |
* | "Not available on this platform yet." |
*
* @param {Push_UnavailableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_unavailable = /** @type {((inputs?: Push_UnavailableInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_UnavailableInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ainda não disponível nesta plataforma.")
	return /** @type {LocalizedString} */ ("Not available on this platform yet.")
});