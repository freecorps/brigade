export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_Not_PagingInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Oncall_Not_PagingInputs */
/**
* | output |
* | --- |
* | "Schedules page people through an escalation policy (below); without a default policy, pages go to the incident's commander, or to everyone who can respond." |
*
* @param {Oncall_Not_PagingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_not_paging: ((inputs?: Oncall_Not_PagingInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Not_PagingInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
