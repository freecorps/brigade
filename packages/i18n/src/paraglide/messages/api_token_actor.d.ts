export type LocalizedString = import('../runtime.js').LocalizedString;
export type Api_Token_ActorInputs = {
    name: NonNullable<unknown>;
    by: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown>, by: NonNullable<unknown> }} Api_Token_ActorInputs */
/**
* | output |
* | --- |
* | "API token {name} (by {by})" |
*
* @param {Api_Token_ActorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const api_token_actor: ((inputs: Api_Token_ActorInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Token_ActorInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
