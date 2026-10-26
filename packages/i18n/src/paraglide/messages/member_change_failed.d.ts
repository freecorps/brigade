export type LocalizedString = import('../runtime.js').LocalizedString;
export type Member_Change_FailedInputs = {
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ reason: NonNullable<unknown> }} Member_Change_FailedInputs */
/**
* | reason | output |
* | --- | --- |
* | "forbidden" | "You can't make this change." |
* | "last_owner" | "A workspace needs at least one owner. Make someone else an owner first." |
* | "not_found" | "This person is no longer a member." |
* | "conflict" | "Someone else changed this member meanwhile. Check the list and try again." |
* | "not_applied" | "Saved. Paging catches up within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't confirm the change; check the list." |
* | * | "Something went wrong. Try again." |
*
* @param {Member_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const member_change_failed: ((inputs: Member_Change_FailedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Change_FailedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
