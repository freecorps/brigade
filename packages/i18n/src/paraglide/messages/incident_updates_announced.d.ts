export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Updates_AnnouncedInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Incident_Updates_AnnouncedInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "1 new update from others" |
* | * | "{countFormatted} new updates from others" |
*
* @param {Incident_Updates_AnnouncedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_updates_announced: ((inputs: Incident_Updates_AnnouncedInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Updates_AnnouncedInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
