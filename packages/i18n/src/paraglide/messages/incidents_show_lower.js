/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Incidents_Show_LowerInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Show {countFormatted} lower-severity incident" |
* | * | "Show {countFormatted} lower-severity incidents" |
*
* @param {Incidents_Show_LowerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_show_lower = /** @type {((inputs: Incidents_Show_LowerInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Show_LowerInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Mostrar ${countFormatted} incidente de menor severidade`);
		return /** @type {LocalizedString} */ (`Mostrar ${countFormatted} incidentes de menor severidade`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Show ${countFormatted} lower-severity incident`);
		return /** @type {LocalizedString} */ (`Show ${countFormatted} lower-severity incidents`)
	}
});