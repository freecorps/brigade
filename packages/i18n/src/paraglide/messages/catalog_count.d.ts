export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_CountInputs = {
    kind: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown> }} Catalog_CountInputs */
/**
* | kind | count | countPlural | output |
* | --- | --- | --- | --- |
* | "services" | * | "one" | "{countFormatted} service" |
* | "services" | * | * | "{countFormatted} services" |
* | "types" | * | "one" | "{countFormatted} type" |
* | "types" | * | * | "{countFormatted} types" |
* | "fields" | * | "one" | "{countFormatted} field" |
* | "fields" | * | * | "{countFormatted} fields" |
* | "options" | * | "one" | "{countFormatted} option" |
* | "options" | * | * | "{countFormatted} options" |
* | "roles" | * | "one" | "{countFormatted} role" |
* | "roles" | * | * | "{countFormatted} roles" |
* | "missing" | * | "one" | "{countFormatted} required field to fill" |
* | "missing" | * | * | "{countFormatted} required fields to fill" |
* | "active" | * | "one" | "{countFormatted} active incident" |
* | "active" | * | * | "{countFormatted} active incidents" |
* | * | * | * | "{countFormatted}" |
*
* @param {Catalog_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const catalog_count: ((inputs: Catalog_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
