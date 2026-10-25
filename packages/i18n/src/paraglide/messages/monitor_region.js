/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ region: NonNullable<unknown> }} Monitor_RegionInputs */



/**
* | region | output |
* | --- | --- |
* | "wnam" | "US West" |
* | "enam" | "US East" |
* | "weur" | "Western Europe" |
* | "eeur" | "Eastern Europe" |
* | "apac" | "Asia-Pacific" |
* | * | "Oceania" |
*
* @param {Monitor_RegionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_region = /** @type {((inputs: Monitor_RegionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_RegionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.region === "wnam") return /** @type {LocalizedString} */ (`EUA Oeste`);
		if (i?.region === "enam") return /** @type {LocalizedString} */ (`EUA Leste`);
		if (i?.region === "weur") return /** @type {LocalizedString} */ (`Europa Ocidental`);
		if (i?.region === "eeur") return /** @type {LocalizedString} */ (`Europa Oriental`);
		if (i?.region === "apac") return /** @type {LocalizedString} */ (`Ásia-Pacífico`);
		return /** @type {LocalizedString} */ (`Oceania`)
	}
	{
		if (i?.region === "wnam") return /** @type {LocalizedString} */ (`US West`);
		if (i?.region === "enam") return /** @type {LocalizedString} */ (`US East`);
		if (i?.region === "weur") return /** @type {LocalizedString} */ (`Western Europe`);
		if (i?.region === "eeur") return /** @type {LocalizedString} */ (`Eastern Europe`);
		if (i?.region === "apac") return /** @type {LocalizedString} */ (`Asia-Pacific`);
		return /** @type {LocalizedString} */ (`Oceania`)
	}
});