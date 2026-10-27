/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ tier: NonNullable<unknown> }} Catalog_TierInputs */



/**
* | tier | output |
* | --- | --- |
* | "tier1" | "Tier 1 · Critical" |
* | "tier2" | "Tier 2 · Important" |
* | "tier3" | "Tier 3 · Supporting" |
* | * | "Tier" |
*
* @param {Catalog_TierInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_tier = /** @type {((inputs: Catalog_TierInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_TierInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.tier === "tier1") return /** @type {LocalizedString} */ (`Nível 1 · Crítico`);
		if (i?.tier === "tier2") return /** @type {LocalizedString} */ (`Nível 2 · Importante`);
		if (i?.tier === "tier3") return /** @type {LocalizedString} */ (`Nível 3 · De apoio`);
		return /** @type {LocalizedString} */ (`Nível`)
	}
	{
		if (i?.tier === "tier1") return /** @type {LocalizedString} */ (`Tier 1 · Critical`);
		if (i?.tier === "tier2") return /** @type {LocalizedString} */ (`Tier 2 · Important`);
		if (i?.tier === "tier3") return /** @type {LocalizedString} */ (`Tier 3 · Supporting`);
		return /** @type {LocalizedString} */ (`Tier`)
	}
});