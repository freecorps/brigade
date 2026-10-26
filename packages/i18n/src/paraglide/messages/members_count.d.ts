export type LocalizedString = import('../runtime.js').LocalizedString;
export type Members_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Members_CountInputs */
/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No members" |
* | * | "one" | "{countFormatted} member" |
* | * | * | "{countFormatted} members" |
*
* @param {Members_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const members_count: ((inputs: Members_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
