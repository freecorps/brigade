export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Last_ResultInputs = {
    state: NonNullable<unknown>;
    when: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ state: NonNullable<unknown>, when: NonNullable<unknown> }} Monitor_Last_ResultInputs */
/**
* | state | output |
* | --- | --- |
* | "paused_you" | "Paused by you {when}" |
* | "paused_other" | "Paused by a teammate {when}" |
* | * | "Last report {when}" |
*
* @param {Monitor_Last_ResultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_last_result: ((inputs: Monitor_Last_ResultInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Last_ResultInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
