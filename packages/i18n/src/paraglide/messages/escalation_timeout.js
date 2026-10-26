/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Escalation_TimeoutInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Next level after {countFormatted} minute" |
* | * | "Next level after {countFormatted} minutes" |
*
* @param {Escalation_TimeoutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_timeout = /** @type {((inputs: Escalation_TimeoutInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TimeoutInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Próximo nível após ${countFormatted} minuto`);
		return /** @type {LocalizedString} */ (`Próximo nível após ${countFormatted} minutos`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Next level after ${countFormatted} minute`);
		return /** @type {LocalizedString} */ (`Next level after ${countFormatted} minutes`)
	}
});