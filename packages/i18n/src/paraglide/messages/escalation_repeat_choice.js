/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Escalation_Repeat_ChoiceInputs */



/**
* | count | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "Don't repeat" |
* | * | "one" | "{countFormatted} more time" |
* | * | * | "{countFormatted} more times" |
*
* @param {Escalation_Repeat_ChoiceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_repeat_choice = /** @type {((inputs: Escalation_Repeat_ChoiceInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Repeat_ChoiceInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Não repetir`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Mais ${countFormatted} vez`);
		return /** @type {LocalizedString} */ (`Mais ${countFormatted} vezes`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`Don't repeat`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} more time`);
		return /** @type {LocalizedString} */ (`${countFormatted} more times`)
	}
});