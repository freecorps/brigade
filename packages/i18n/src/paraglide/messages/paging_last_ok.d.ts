export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_Last_OkInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Paging_Last_OkInputs */
/**
* | output |
* | --- |
* | "Last test page that got through: {time}" |
*
* @param {Paging_Last_OkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_last_ok: ((inputs: Paging_Last_OkInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Last_OkInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
