export type LocalizedString = import('../runtime.js').LocalizedString;
export type Accept_ErrorInputs = {
    reason: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown>, workspace: NonNullable<unknown> }} Accept_ErrorInputs */
/**
* | reason | output |
* | --- | --- |
* | "workspace_full" | "{workspace} has reached its member limit. Ask an owner to make room." |
* | "workspace_limit" | "You already belong to as many workspaces as Brigade allows. Leave one first." |
* | "already_member" | "You're already a member of {workspace}." |
* | "conflict" | "The invitation changed meanwhile. Reload the page." |
* | "not_applied" | "You joined. Paging catches up on its own within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't reach Brigade. Check your connection and try again." |
* | * | "Something went wrong. Try again." |
*
* @param {Accept_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const accept_error: ((inputs: Accept_ErrorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Accept_ErrorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
