/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_No_DefaultInputs */



/**
* | output |
* | --- |
* | "No default policy: pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_No_DefaultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_no_default = /** @type {((inputs?: Escalation_No_DefaultInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_No_DefaultInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nenhuma política padrão: as chamadas vão para o comandante do incidente, ou para todos que podem responder.")
	return /** @type {LocalizedString} */ ("No default policy: pages go to the incident's commander, or to everyone who can respond.")
});