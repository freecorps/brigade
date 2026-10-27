export type LocalizedString = import('../runtime.js').LocalizedString;
export type Widget_UntilInputs = {
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ time: NonNullable<unknown> }} Widget_UntilInputs */
/**
* | output |
* | --- |
* | "Until {time}" |
*
* @param {Widget_UntilInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const widget_until: ((inputs: Widget_UntilInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_UntilInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
