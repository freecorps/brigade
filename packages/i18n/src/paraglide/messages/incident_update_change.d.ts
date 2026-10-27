export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_Update_ChangeInputs = {
    part: NonNullable<unknown>;
    time: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Update_ChangeInputs */
/**
* | part | output |
* | --- | --- |
* | "edited" | "edited" |
* | "edited_at" | "Edited {time}" |
* | "actions" | "Update actions" |
* | "edit" | "Edit" |
* | "remove" | "Remove" |
* | "edit_label" | "Edit your update" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "cancel" | "Cancel" |
* | "unchanged" | "The update already says that." |
* | "gone" | "This update was removed, so there's nothing to change." |
* | "edit_failed" | "Couldn't save the edit. {reason}" |
* | "remove_title" | "Remove this update?" |
* | "remove_body" | "Its text is removed for everyone, here and where Brigade mirrored it in Slack. The timeline keeps a line saying who removed it. What was published on the sta..." |
* | "remove_confirm" | "Remove update" |
* | "removing" | "Removing…" |
* | "remove_failed" | "Couldn't remove the update. {reason}" |
* | "status_page_note" | "Editing doesn't change what was published on the status page." |
* | * | "edited" |
*
* @param {Incident_Update_ChangeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_update_change: ((inputs: Incident_Update_ChangeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_ChangeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
