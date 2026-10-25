export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_RoleInputs = {
    role: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ role: NonNullable<unknown> }} Incident_RoleInputs */
/**
* | role | output |
* | --- | --- |
* | "commander" | "Incident commander" |
* | "communications" | "Communications lead" |
* | * | "Operations lead" |
*
* @param {Incident_RoleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_role: ((inputs: Incident_RoleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_RoleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
