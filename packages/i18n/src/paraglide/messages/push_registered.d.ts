export type LocalizedString = import('../runtime.js').LocalizedString;
export type Push_RegisteredInputs = {
    shard: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ shard: NonNullable<unknown> }} Push_RegisteredInputs */
/**
* | output |
* | --- |
* | "Registered on {shard}" |
*
* @param {Push_RegisteredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const push_registered: ((inputs: Push_RegisteredInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_RegisteredInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
