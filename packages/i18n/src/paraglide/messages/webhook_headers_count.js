/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Webhook_Headers_CountInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} custom header" |
* | * | "{countFormatted} custom headers" |
*
* @param {Webhook_Headers_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const webhook_headers_count = /** @type {((inputs: Webhook_Headers_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_Headers_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} cabeçalho personalizado`);
		return /** @type {LocalizedString} */ (`${countFormatted} cabeçalhos personalizados`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} custom header`);
		return /** @type {LocalizedString} */ (`${countFormatted} custom headers`)
	}
});