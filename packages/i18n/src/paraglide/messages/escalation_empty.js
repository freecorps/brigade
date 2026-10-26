/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_EmptyInputs */



/**
* | output |
* | --- |
* | "No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Escalation_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_empty = /** @type {((inputs?: Escalation_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ainda não há políticas de escalonamento. Sem uma política padrão, as chamadas vão para o comandante do incidente, ou para todos que podem responder.")
	return /** @type {LocalizedString} */ ("No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond.")
});