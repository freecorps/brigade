export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_RoleInputs = {
    role: NonNullable<unknown>;
    form: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ role: NonNullable<unknown>, form: NonNullable<unknown> }} Incident_RoleInputs */
/**
* | role | form | output |
* | --- | --- | --- |
* | "commander" | "sentence" | "incident commander" |
* | "communications" | "sentence" | "communications lead" |
* | "operations" | "sentence" | "operations lead" |
* | "commander" | * | "Incident commander" |
* | "communications" | * | "Communications lead" |
* | "operations" | * | "Operations lead" |
* | "deleted" | "sentence" | "deleted role" |
* | "deleted" | * | "Deleted role" |
* | * | * | "Role" |
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
