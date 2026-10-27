/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Alerts_RepeatsInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Sent {countFormatted} more time" |
* | * | "Sent {countFormatted} more times" |
*
* @param {Alerts_RepeatsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const alerts_repeats = /** @type {((inputs: Alerts_RepeatsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Alerts_RepeatsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Enviado mais ${countFormatted} vez`);
		return /** @type {LocalizedString} */ (`Enviado mais ${countFormatted} vezes`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Sent ${countFormatted} more time`);
		return /** @type {LocalizedString} */ (`Sent ${countFormatted} more times`)
	}
});