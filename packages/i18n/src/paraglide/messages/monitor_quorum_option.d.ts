export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Quorum_OptionInputs = {
    kind: NonNullable<unknown>;
    count: NonNullable<unknown>;
    total: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown>, total: NonNullable<unknown> }} Monitor_Quorum_OptionInputs */
/**
* | kind | output |
* | --- | --- |
* | "majority" | "Majority (default)" |
* | * | "{count} of {total}" |
*
* @param {Monitor_Quorum_OptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_quorum_option: ((inputs: Monitor_Quorum_OptionInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Quorum_OptionInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
