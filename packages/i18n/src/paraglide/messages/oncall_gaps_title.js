/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Oncall_Gaps_TitleInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "A schedule has a layer with nobody in it" |
* | * | "{countFormatted} schedules have a layer with nobody in it" |
*
* @param {Oncall_Gaps_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_gaps_title = /** @type {((inputs: Oncall_Gaps_TitleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_TitleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Uma escala tem uma camada sem ninguém`);
		return /** @type {LocalizedString} */ (`${countFormatted} escalas têm uma camada sem ninguém`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`A schedule has a layer with nobody in it`);
		return /** @type {LocalizedString} */ (`${countFormatted} schedules have a layer with nobody in it`)
	}
});