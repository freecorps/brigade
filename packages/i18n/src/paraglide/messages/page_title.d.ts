export type LocalizedString = import('../runtime.js').LocalizedString;
export type Page_TitleInputs = {
    page: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ page: NonNullable<unknown> }} Page_TitleInputs */
/**
* | output |
* | --- |
* | "{page} · Brigade" |
*
* @param {Page_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const page_title: ((inputs: Page_TitleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_TitleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
