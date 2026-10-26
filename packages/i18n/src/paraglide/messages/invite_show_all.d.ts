export type LocalizedString = import('../runtime.js').LocalizedString;
export type Invite_Show_AllInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Invite_Show_AllInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Show all {countFormatted} invitation" |
* | * | "Show all {countFormatted} invitations" |
*
* @param {Invite_Show_AllInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const invite_show_all: ((inputs: Invite_Show_AllInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Invite_Show_AllInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
