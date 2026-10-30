/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Incidents_All_Clear_HintInputs */



/**
* | output |
* | --- |
* | "New incidents show up here as soon as they're declared." |
*
* @param {Incidents_All_Clear_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_all_clear_hint = /** @type {((inputs?: Incidents_All_Clear_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_All_Clear_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Novos incidentes aparecem aqui assim que forem declarados.")
	return /** @type {LocalizedString} */ ("New incidents show up here as soon as they're declared.")
});