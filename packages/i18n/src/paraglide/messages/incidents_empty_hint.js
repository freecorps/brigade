/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Incidents_Empty_HintInputs */



/**
* | output |
* | --- |
* | "Declare one here and it shows up in every open tab." |
*
* @param {Incidents_Empty_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_empty_hint = /** @type {((inputs?: Incidents_Empty_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Empty_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Declare um aqui e ele aparece em todas as abas abertas.")
	return /** @type {LocalizedString} */ ("Declare one here and it shows up in every open tab.")
});