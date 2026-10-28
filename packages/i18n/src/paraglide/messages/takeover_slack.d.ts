export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_SlackInputs = {
    team: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ team: NonNullable<unknown> }} Takeover_SlackInputs */
/**
* | output |
* | --- |
* | "Slack disconnected from {team}" |
*
* @param {Takeover_SlackInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_slack: ((inputs: Takeover_SlackInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_SlackInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
