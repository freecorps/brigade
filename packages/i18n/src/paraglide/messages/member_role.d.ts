export type LocalizedString = import('../runtime.js').LocalizedString;
export type Member_RoleInputs = {
    role: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ role: NonNullable<unknown> }} Member_RoleInputs */
/**
* | role | output |
* | --- | --- |
* | "owner" | "Owner" |
* | "admin" | "Admin" |
* | "responder" | "Responder" |
* | "viewer" | "Viewer" |
* | * | "Member" |
*
* @param {Member_RoleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const member_role: ((inputs: Member_RoleInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_RoleInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
