/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Not_PagingInputs */



/**
* | output |
* | --- |
* | "Schedules page people through an escalation policy (below); without a default policy, pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Oncall_Not_PagingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_not_paging = /** @type {((inputs?: Oncall_Not_PagingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Not_PagingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("As escalas chamam pessoas por meio de uma política de escalonamento (abaixo); sem uma política padrão, as chamadas vão para o comandante do incidente, ou para todos que podem responder.")
	return /** @type {LocalizedString} */ ("Schedules page people through an escalation policy (below); without a default policy, pages go to the incident's commander, or to everyone who can respond.")
});