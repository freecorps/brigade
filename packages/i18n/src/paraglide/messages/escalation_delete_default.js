/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_Delete_DefaultInputs */



/**
* | output |
* | --- |
* | "It is the default: pages go back to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_Delete_DefaultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_delete_default = /** @type {((inputs?: Escalation_Delete_DefaultInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Delete_DefaultInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("É a política padrão: as chamadas voltam a ir para o comandante do incidente, ou para todos que podem responder.")
	return /** @type {LocalizedString} */ ("It is the default: pages go back to the incident's commander, or to everyone who can respond.")
});