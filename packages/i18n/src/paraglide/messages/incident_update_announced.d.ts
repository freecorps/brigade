export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Update_AnnouncedInputs = {
    actor: NonNullable<unknown>;
    body: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ actor: NonNullable<unknown>, body: NonNullable<unknown> }} Incident_Update_AnnouncedInputs */
/**
* | output |
* | --- |
* | "{actor} posted an update: {body}" |
*
* @param {Incident_Update_AnnouncedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_update_announced: ((inputs: Incident_Update_AnnouncedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_AnnouncedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
