export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_Revoked_CountInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Takeover_Revoked_CountInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} heartbeat URL turned off" |
* | * | "{countFormatted} heartbeat URLs turned off" |
*
* @param {Takeover_Revoked_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_revoked_count: ((inputs: Takeover_Revoked_CountInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_Revoked_CountInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
