/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Escalation_RepeatInputs */



/**
* | count | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "Doesn't repeat" |
* | * | "one" | "Repeats {countFormatted} more time" |
* | * | * | "Repeats {countFormatted} more times" |
*
* @param {Escalation_RepeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_repeat = /** @type {((inputs: Escalation_RepeatInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_RepeatInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Não se repete`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Repete mais ${countFormatted} vez`);
		return /** @type {LocalizedString} */ (`Repete mais ${countFormatted} vezes`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Doesn't repeat`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Repeats ${countFormatted} more time`);
		return /** @type {LocalizedString} */ (`Repeats ${countFormatted} more times`)
	}
});