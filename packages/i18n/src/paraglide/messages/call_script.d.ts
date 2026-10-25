export type LocalizedString = import('../runtime.js').LocalizedString;
export type Call_ScriptInputs = {
    title: NonNullable<unknown>;
    body: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ title: NonNullable<unknown>, body: NonNullable<unknown> }} Call_ScriptInputs */
/**
* | output |
* | --- |
* | "Brigade page. {title}. {body}" |
*
* @param {Call_ScriptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const call_script: ((inputs: Call_ScriptInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_ScriptInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
