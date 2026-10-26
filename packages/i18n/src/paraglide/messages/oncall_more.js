/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Oncall_MoreInputs */



/**
* | countPlural | output |
* | --- | --- |
* | * | "+{countFormatted} more" |
*
* @param {Oncall_MoreInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_more = /** @type {((inputs: Oncall_MoreInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_MoreInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		return /** @type {LocalizedString} */ (`mais ${countFormatted}`)
	}
	{
		const countFormatted = registry.number("en", i?.count, {}, true);
		return /** @type {LocalizedString} */ (`+${countFormatted} more`)
	}
});