export type LocalizedString = import('../runtime.js').LocalizedString;
export type Members_Show_AllInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Members_Show_AllInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Show all {countFormatted} member" |
* | * | "Show all {countFormatted} members" |
*
* @param {Members_Show_AllInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const members_show_all: ((inputs: Members_Show_AllInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_Show_AllInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
