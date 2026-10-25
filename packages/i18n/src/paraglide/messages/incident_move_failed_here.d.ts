export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Move_Failed_HereInputs = {
    status: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ status: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Move_Failed_HereInputs */
/**
* | output |
* | --- |
* | "Couldn't move it to {status}. {reason}" |
*
* @param {Incident_Move_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_move_failed_here: ((inputs: Incident_Move_Failed_HereInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Move_Failed_HereInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
