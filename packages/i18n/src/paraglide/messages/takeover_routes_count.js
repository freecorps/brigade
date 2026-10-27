/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Takeover_Routes_CountInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} alert route turned off" |
* | * | "{countFormatted} alert routes turned off" |
*
* @param {Takeover_Routes_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const takeover_routes_count = /** @type {((inputs: Takeover_Routes_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Routes_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} rota de alertas desligada`);
		return /** @type {LocalizedString} */ (`${countFormatted} rotas de alertas desligadas`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} alert route turned off`);
		return /** @type {LocalizedString} */ (`${countFormatted} alert routes turned off`)
	}
});