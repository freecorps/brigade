/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Takeover_Paused_CountInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} monitor paused" |
* | * | "{countFormatted} monitors paused" |
*
* @param {Takeover_Paused_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const takeover_paused_count = /** @type {((inputs: Takeover_Paused_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Paused_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} monitor pausado`);
		return /** @type {LocalizedString} */ (`${countFormatted} monitores pausados`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} monitor paused`);
		return /** @type {LocalizedString} */ (`${countFormatted} monitors paused`)
	}
});