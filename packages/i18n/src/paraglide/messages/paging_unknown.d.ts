export type LocalizedString = import('../runtime.js').LocalizedString;
export type Paging_UnknownInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Paging_UnknownInputs */
/**
* | output |
* | --- |
* | "The paging self-check hasn't run yet. Once it runs, a heartbeat goes through Brigade's event queue every minute and checks that the push relay accepts Brigad..." |
*
* @param {Paging_UnknownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const paging_unknown: ((inputs?: Paging_UnknownInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnknownInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
