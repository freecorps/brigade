export type LocalizedString = import('../runtime.js').LocalizedString;
export type Maintenance_CardInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    until: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown> }} Maintenance_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Scheduled maintenance" |
* | "description" | "Tell customers about planned work. It shows on the status page, and subscribers get an email when it's planned, when it starts and when it ends." |
* | "empty" | "No maintenance planned." |
* | "schedule" | "Schedule maintenance" |
* | "title_label" | "Public title" |
* | "body_label" | "What the public should know" |
* | "components_label" | "Affected components" |
* | "starts_label" | "Starts" |
* | "ends_label" | "Ends" |
* | "times_hint" | "In your time zone ({name}). The public page shows UTC." |
* | "save" | "Schedule" |
* | "saving" | "Saving…" |
* | "update" | "Save" |
* | "failed" | "Couldn't save. Try again." |
* | "title_required" | "The public needs a title." |
* | "body_required" | "Write what the public should know." |
* | "times_required" | "Pick when it starts and ends." |
* | "ends_before" | "The window must end after it starts." |
* | "too_long" | "A window lasts at most 14 days." |
* | "ended" | "That window has already ended." |
* | "limit" | "At most 20 windows can be planned at once." |
* | "phase_scheduled" | "Scheduled" |
* | "phase_in_progress" | "In progress" |
* | "phase_completed" | "Completed" |
* | "window" | "{time} to {until}" |
* | "edit" | "Edit" |
* | "cancel" | "Cancel" |
* | "end_now" | "End now" |
* | "call_off" | "Call off" |
* | "call_off_confirm" | "Call off {name}? It leaves the status page and subscribers get an email saying so." |
* | "keep" | "Keep" |
* | "not_set_up" | "Set up the status page first to plan maintenance on it." |
* | "viewer" | "Owners, admins and responders can schedule maintenance." |
* | "past_title" | "Completed" |
* | * | "Maintenance" |
*
* @param {Maintenance_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const maintenance_card: ((inputs: Maintenance_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Maintenance_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
