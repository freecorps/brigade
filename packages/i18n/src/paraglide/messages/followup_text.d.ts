export type LocalizedString = import('../runtime.js').LocalizedString;
export type Followup_TextInputs = {
    text: NonNullable<unknown>;
    name: NonNullable<unknown>;
    date: NonNullable<unknown>;
    count: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, date: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Followup_TextInputs */
/**
* | text | output |
* | --- | --- |
* | "title" | "Follow-ups" |
* | "description" | "What this incident leaves to do, with an owner and a due date." |
* | "empty" | "No follow-ups yet." |
* | "add" | "Add follow-up" |
* | "title_label" | "What needs doing" |
* | "title_placeholder" | "Add a retry budget to the payment client" |
* | "owner_label" | "Owner" |
* | "no_owner" | "No owner" |
* | "due_label" | "Due" |
* | "no_due" | "No due date" |
* | "link_label" | "Issue link" |
* | "link_placeholder" | "https://" |
* | "link_invalid" | "Enter a link that starts with http:// or https://." |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "edit" | "Edit {name}" |
* | "delete" | "Remove {name}" |
* | "delete_confirm" | "Remove {name}? It stays on the timeline." |
* | "mark_done" | "Mark {name} as done" |
* | "mark_open" | "Reopen {name}" |
* | "due_on" | "Due {date}" |
* | "overdue" | "Overdue since {date}" |
* | "done_on" | "Done {date}" |
* | "open_link" | "Open issue" |
* | "owner_former" | "Former member" |
* | "done_count" | "Done: {count}" |
* | "limit" | "This incident has as many follow-ups as it can hold. Remove a done one first." |
* | "change_failed" | "Couldn't change {name}: {reason}" |
* | "read_only" | "Only responders, admins and owners change follow-ups." |
* | "open_title" | "Open follow-ups" |
* | "open_description" | "Every open follow-up in the workspace, soonest due first." |
* | "open_empty" | "Nothing open. Follow-ups added to incidents show up here until they're done." |
* | "open_link_all" | "All open follow-ups" |
* | "overdue_count" | "Overdue: {count}" |
* | "loading" | "Loading follow-ups…" |
* | "load_failed" | "Couldn't load follow-ups: {reason}" |
* | "incident_column" | "Incident" |
* | "mine" | "Mine only" |
* | "back" | "Overview" |
* | "title_required" | "Say what needs doing." |
* | * | "Follow-ups" |
*
* @param {Followup_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const followup_text: ((inputs: Followup_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Followup_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
