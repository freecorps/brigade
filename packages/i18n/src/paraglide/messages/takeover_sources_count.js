/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Takeover_Sources_CountInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} alert source URL turned off" |
* | * | "{countFormatted} alert source URLs turned off" |
*
* @param {Takeover_Sources_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const takeover_sources_count = /** @type {((inputs: Takeover_Sources_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Sources_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} URL de fonte de alertas desativada`);
		return /** @type {LocalizedString} */ (`${countFormatted} URLs de fontes de alertas desativadas`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} alert source URL turned off`);
		return /** @type {LocalizedString} */ (`${countFormatted} alert source URLs turned off`)
	}
});