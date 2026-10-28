export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_Group_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Status_Group_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} component" |
* | * | "{countFormatted} components" |
*
* @param {Status_Group_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_group_count: ((inputs: Status_Group_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_Group_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
