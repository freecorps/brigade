export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Form_NoteInputs = {
    kind: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, time: NonNullable<unknown> }} Monitor_Form_NoteInputs */
/**
* | kind | output |
* | --- | --- |
* | "status_5xx" | "A 5xx status means the server failed. Listed here, it counts as up, so this monitor won't page for it." |
* | "quorum_all" | "Every region must see it down: an outage only some regions see won't open an incident. A region that stops reporting is left out until it reports again." |
* | * | "Opens an incident after about {time} of failed checks." |
*
* @param {Monitor_Form_NoteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_form_note: ((inputs: Monitor_Form_NoteInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Form_NoteInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
