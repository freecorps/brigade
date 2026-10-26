export type LocalizedString = import('../runtime.js').LocalizedString;
export type Members_PartInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Members_PartInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Members" |
* | "description" | "Owners and admins change roles and remove members. Someone removed stops being paged right away." |
* | "read_only" | "Only owners and admins change roles or remove members." |
* | "you" | "You" |
* | "unnamed" | "Unnamed member" |
* | "role_label" | "Role" |
* | "remove" | "Remove" |
* | "leave" | "Leave workspace" |
* | "remove_prompt" | "Remove {name} from the workspace? They lose access and stop being paged right away." |
* | "leave_prompt" | "Leave this workspace? You lose access and stop being paged right away." |
* | "cancel" | "Cancel" |
* | "saving" | "Saving…" |
* | "empty" | "Nobody else is in this workspace yet." |
* | "load_failed" | "Couldn't load the members." |
* | "demote" | "Change role" |
* | "retry" | "Try again" |
* | "only_owner" | "You're the only owner. Make someone else an owner before you can leave or change your role." |
* | * | "Members" |
*
* @param {Members_PartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const members_part: ((inputs: Members_PartInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_PartInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
