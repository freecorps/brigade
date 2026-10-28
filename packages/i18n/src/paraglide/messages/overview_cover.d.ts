export type LocalizedString = import('../runtime.js').LocalizedString;
export type Overview_CoverInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    from: NonNullable<unknown>;
    to: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, from: NonNullable<unknown>, to: NonNullable<unknown> }} Overview_CoverInputs */
/**
* | part | output |
* | --- | --- |
* | "now_title" | "On call now" |
* | "all_schedules" | "All schedules" |
* | "cover_title" | "The next 24 hours" |
* | "cover_description" | "Who each schedule pages, from now on. A hatched stretch has nobody on call." |
* | "now" | "Now" |
* | "segment" | "{name}, {from} to {to}" |
* | "set_up" | "Set up on call" |
* | * | "Brigade" |
*
* @param {Overview_CoverInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const overview_cover: ((inputs: Overview_CoverInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_CoverInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
