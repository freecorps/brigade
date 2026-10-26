/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, level: NonNullable<unknown> }} Escalation_ProgressInputs */



/**
* | part | output |
* | --- | --- |
* | "running" | "Escalating" |
* | "resolved" | "Stopped: resolved {time}" |
* | "next_level" | "Level {level} at {time}" |
* | "next_repeat" | "Level 1 again at {time}" |
* | "next_end" | "Everyone who can respond at {time}" |
* | "fallback_unreachable" | "No level could reach anyone: paged everyone who can respond" |
* | "fallback_exhausted" | "Nobody acknowledged after every level: paged everyone who can respond" |
* | "fallback_stalled" | "A level kept failing to fire: paged everyone who can respond" |
* | * | "Escalation" |
*
* @param {Escalation_ProgressInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_progress = /** @type {((inputs: Escalation_ProgressInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_ProgressInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "running") return /** @type {LocalizedString} */ (`Escalonando`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`Parado: resolvido ${i?.time}`);
		if (i?.part === "next_level") return /** @type {LocalizedString} */ (`Nível ${i?.level} às ${i?.time}`);
		if (i?.part === "next_repeat") return /** @type {LocalizedString} */ (`Nível 1 de novo às ${i?.time}`);
		if (i?.part === "next_end") return /** @type {LocalizedString} */ (`Todos que podem responder às ${i?.time}`);
		if (i?.part === "fallback_unreachable") return /** @type {LocalizedString} */ (`Nenhum nível alcançou ninguém: todos que podem responder foram chamados`);
		if (i?.part === "fallback_exhausted") return /** @type {LocalizedString} */ (`Ninguém confirmou depois de todos os níveis: todos que podem responder foram chamados`);
		if (i?.part === "fallback_stalled") return /** @type {LocalizedString} */ (`Um nível continuou falhando: todos que podem responder foram chamados`);
		return /** @type {LocalizedString} */ (`Escalonamento`)
	}
	{
		if (i?.part === "running") return /** @type {LocalizedString} */ (`Escalating`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`Stopped: resolved ${i?.time}`);
		if (i?.part === "next_level") return /** @type {LocalizedString} */ (`Level ${i?.level} at ${i?.time}`);
		if (i?.part === "next_repeat") return /** @type {LocalizedString} */ (`Level 1 again at ${i?.time}`);
		if (i?.part === "next_end") return /** @type {LocalizedString} */ (`Everyone who can respond at ${i?.time}`);
		if (i?.part === "fallback_unreachable") return /** @type {LocalizedString} */ (`No level could reach anyone: paged everyone who can respond`);
		if (i?.part === "fallback_exhausted") return /** @type {LocalizedString} */ (`Nobody acknowledged after every level: paged everyone who can respond`);
		if (i?.part === "fallback_stalled") return /** @type {LocalizedString} */ (`A level kept failing to fire: paged everyone who can respond`);
		return /** @type {LocalizedString} */ (`Escalation`)
	}
});