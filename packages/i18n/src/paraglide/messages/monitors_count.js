/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Monitors_CountInputs */



/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No monitors" |
* | * | "one" | "{countFormatted} monitor" |
* | * | * | "{countFormatted} monitors" |
*
* @param {Monitors_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitors_count = /** @type {((inputs: Monitors_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countExact = i?.count;
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`Nenhum monitor`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} monitor`);
		return /** @type {LocalizedString} */ (`${countFormatted} monitores`)
	}
	{
		const countExact = i?.count;
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`No monitors`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} monitor`);
		return /** @type {LocalizedString} */ (`${countFormatted} monitors`)
	}
});