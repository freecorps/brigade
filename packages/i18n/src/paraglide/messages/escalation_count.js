/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown> }} Escalation_CountInputs */



/**
* | kind | count | countPlural | output |
* | --- | --- | --- | --- |
* | "policies" | * | "one" | "{countFormatted} policy" |
* | "policies" | * | * | "{countFormatted} policies" |
* | "timeout" | * | "one" | "Next level after {countFormatted} minute" |
* | "timeout" | * | * | "Next level after {countFormatted} minutes" |
* | "repeat" | "0" | * | "Doesn't repeat" |
* | "repeat" | * | "one" | "Repeats {countFormatted} more time" |
* | "repeat" | * | * | "Repeats {countFormatted} more times" |
* | "repeat_choice" | "0" | * | "Don't repeat" |
* | "repeat_choice" | * | "one" | "{countFormatted} more time" |
* | "repeat_choice" | * | * | "{countFormatted} more times" |
* | "timeout_repeat" | * | "one" | "Level 1 again after {countFormatted} minute" |
* | "timeout_repeat" | * | * | "Level 1 again after {countFormatted} minutes" |
* | "timeout_end" | * | "one" | "Everyone who can respond after {countFormatted} minute" |
* | "timeout_end" | * | * | "Everyone who can respond after {countFormatted} minutes" |
* | "earlier" | * | * | "Earlier levels ({countFormatted})" |
* | "show_levels" | * | * | "Show all {countFormatted} levels" |
* | "more_missed" | * | * | "and {countFormatted} more" |
* | * | * | * | "{countFormatted}" |
*
* @param {Escalation_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_count = /** @type {((inputs: Escalation_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (i?.kind === "repeat" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Não se repete`);
		if (i?.kind === "repeat_choice" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Não repetir`);
		if (i?.kind === "policies" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} política`);
		if (i?.kind === "timeout" && countPlural === "one") return /** @type {LocalizedString} */ (`Próximo nível após ${countFormatted} minuto`);
		if (i?.kind === "repeat" && countPlural === "one") return /** @type {LocalizedString} */ (`Repete mais ${countFormatted} vez`);
		if (i?.kind === "repeat_choice" && countPlural === "one") return /** @type {LocalizedString} */ (`Mais ${countFormatted} vez`);
		if (i?.kind === "timeout_repeat" && countPlural === "one") return /** @type {LocalizedString} */ (`Nível 1 de novo após ${countFormatted} minuto`);
		if (i?.kind === "timeout_end" && countPlural === "one") return /** @type {LocalizedString} */ (`Todos que podem responder após ${countFormatted} minuto`);
		if (i?.kind === "policies") return /** @type {LocalizedString} */ (`${countFormatted} políticas`);
		if (i?.kind === "timeout") return /** @type {LocalizedString} */ (`Próximo nível após ${countFormatted} minutos`);
		if (i?.kind === "repeat") return /** @type {LocalizedString} */ (`Repete mais ${countFormatted} vezes`);
		if (i?.kind === "repeat_choice") return /** @type {LocalizedString} */ (`Mais ${countFormatted} vezes`);
		if (i?.kind === "timeout_repeat") return /** @type {LocalizedString} */ (`Nível 1 de novo após ${countFormatted} minutos`);
		if (i?.kind === "timeout_end") return /** @type {LocalizedString} */ (`Todos que podem responder após ${countFormatted} minutos`);
		if (i?.kind === "earlier") return /** @type {LocalizedString} */ (`Níveis anteriores (${countFormatted})`);
		if (i?.kind === "show_levels") return /** @type {LocalizedString} */ (`Mostrar os ${countFormatted} níveis`);
		if (i?.kind === "more_missed") return /** @type {LocalizedString} */ (`e mais ${countFormatted}`);
		return /** @type {LocalizedString} */ (`${countFormatted}`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (i?.kind === "repeat" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Doesn't repeat`);
		if (i?.kind === "repeat_choice" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Don't repeat`);
		if (i?.kind === "policies" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} policy`);
		if (i?.kind === "timeout" && countPlural === "one") return /** @type {LocalizedString} */ (`Next level after ${countFormatted} minute`);
		if (i?.kind === "repeat" && countPlural === "one") return /** @type {LocalizedString} */ (`Repeats ${countFormatted} more time`);
		if (i?.kind === "repeat_choice" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} more time`);
		if (i?.kind === "timeout_repeat" && countPlural === "one") return /** @type {LocalizedString} */ (`Level 1 again after ${countFormatted} minute`);
		if (i?.kind === "timeout_end" && countPlural === "one") return /** @type {LocalizedString} */ (`Everyone who can respond after ${countFormatted} minute`);
		if (i?.kind === "policies") return /** @type {LocalizedString} */ (`${countFormatted} policies`);
		if (i?.kind === "timeout") return /** @type {LocalizedString} */ (`Next level after ${countFormatted} minutes`);
		if (i?.kind === "repeat") return /** @type {LocalizedString} */ (`Repeats ${countFormatted} more times`);
		if (i?.kind === "repeat_choice") return /** @type {LocalizedString} */ (`${countFormatted} more times`);
		if (i?.kind === "timeout_repeat") return /** @type {LocalizedString} */ (`Level 1 again after ${countFormatted} minutes`);
		if (i?.kind === "timeout_end") return /** @type {LocalizedString} */ (`Everyone who can respond after ${countFormatted} minutes`);
		if (i?.kind === "earlier") return /** @type {LocalizedString} */ (`Earlier levels (${countFormatted})`);
		if (i?.kind === "show_levels") return /** @type {LocalizedString} */ (`Show all ${countFormatted} levels`);
		if (i?.kind === "more_missed") return /** @type {LocalizedString} */ (`and ${countFormatted} more`);
		return /** @type {LocalizedString} */ (`${countFormatted}`)
	}
});