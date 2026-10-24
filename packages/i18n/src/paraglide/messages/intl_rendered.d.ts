export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_RenderedInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Intl_RenderedInputs */
/**
* | output |
* | --- |
* | "Rendered by the shared helpers" |
*
* @param {Intl_RenderedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_rendered: ((inputs?: Intl_RenderedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_RenderedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
