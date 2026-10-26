export type LocalizedString = import('../runtime.js').LocalizedString;
export type Member_Demote_PromptInputs = {
    kind: NonNullable<unknown>;
    role: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, role: NonNullable<unknown> }} Member_Demote_PromptInputs */
/**
* | kind | output |
* | --- | --- |
* | "owner" | "Change your role to {role}? You can no longer manage owners; only an owner can give it back." |
* | * | "Change your role to {role}? You can no longer manage members; only an owner or admin can give it back." |
*
* @param {Member_Demote_PromptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const member_demote_prompt: ((inputs: Member_Demote_PromptInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Demote_PromptInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
