/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown>, count: NonNullable<unknown> }} Oncall_Status_ManyInputs */



/**
* | countPlural | output |
* | --- | --- |
* | * | "On call until {time} ({countFormatted} schedules)" |
*
* @param {Oncall_Status_ManyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_status_many = /** @type {((inputs: Oncall_Status_ManyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Status_ManyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		return /** @type {LocalizedString} */ (`De plantão até ${i?.time} (${countFormatted} escalas)`)
	}
	{
		const countFormatted = registry.number("en", i?.count, {}, true);
		return /** @type {LocalizedString} */ (`On call until ${i?.time} (${countFormatted} schedules)`)
	}
});