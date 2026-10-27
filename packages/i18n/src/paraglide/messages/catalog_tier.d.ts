export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_TierInputs = {
    tier: NonNullable<unknown>;
};
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
export declare const catalog_tier: ((inputs: Catalog_TierInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_TierInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
