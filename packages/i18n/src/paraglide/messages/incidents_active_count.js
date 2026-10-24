/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Incidents_Active_CountInputs */



/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No active incidents" |
* | * | "one" | "{countFormatted} active incident" |
* | * | * | "{countFormatted} active incidents" |
*
* @param {Incidents_Active_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_active_count = /** @type {((inputs: Incidents_Active_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Active_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countExact = i?.count;
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`Nenhum incidente ativo`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} incidente ativo`);
		return /** @type {LocalizedString} */ (`${countFormatted} incidentes ativos`)
	}
	{
		const countExact = i?.count;
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`No active incidents`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} active incident`);
		return /** @type {LocalizedString} */ (`${countFormatted} active incidents`)
	}
});