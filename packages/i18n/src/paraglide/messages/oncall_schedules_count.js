/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Oncall_Schedules_CountInputs */



/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No schedules" |
* | * | "one" | "{countFormatted} schedule" |
* | * | * | "{countFormatted} schedules" |
*
* @param {Oncall_Schedules_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_schedules_count = /** @type {((inputs: Oncall_Schedules_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Schedules_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countExact = i?.count;
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`Nenhuma escala`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} escala`);
		return /** @type {LocalizedString} */ (`${countFormatted} escalas`)
	}
	{
		const countExact = i?.count;
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`No schedules`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} schedule`);
		return /** @type {LocalizedString} */ (`${countFormatted} schedules`)
	}
});