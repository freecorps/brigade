export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Page_AgainInputs = {
    part: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Page_AgainInputs */
/**
* | part | output |
* | --- | --- |
* | "action" | "Page again" |
* | "pending" | "Paging again…" |
* | "already" | "Someone already paged this again." |
* | "failed" | "Couldn't page again. {reason}" |
* | * | "Page again" |
*
* @param {Incident_Page_AgainInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_page_again: ((inputs: Incident_Page_AgainInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Page_AgainInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
