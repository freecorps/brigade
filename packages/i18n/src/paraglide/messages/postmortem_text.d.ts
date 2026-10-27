export type LocalizedString = import('../runtime.js').LocalizedString;
export type Postmortem_TextInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    count: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Postmortem_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Postmortem" |
* | "description" | "What happened and what the team learned, section by section. Plain text." |
* | "empty" | "No postmortem yet." |
* | "start" | "Write postmortem" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "saving" | "Saving…" |
* | "section_summary" | "Summary" |
* | "section_impact" | "Impact" |
* | "section_timeline" | "Timeline" |
* | "section_rootCause" | "Root cause" |
* | "section_wentWell" | "What went well" |
* | "section_wentPoorly" | "What went poorly" |
* | "section_followUps" | "Follow-ups" |
* | "section_empty" | "Not written yet." |
* | "updated" | "Revision {count}, saved {time} by {name}" |
* | "conflict" | "Someone saved the postmortem while you were editing. Your text is still here: copy what you need, then reload their version." |
* | "reload" | "Load the latest version" |
* | "save_failed" | "Couldn't save the postmortem: {reason}" |
* | "ai_draft" | "Draft with AI" |
* | "ai_redraft" | "Draft again with AI" |
* | "ai_hint" | "Workers AI writes a first draft from the timeline, updates and follow-ups. Nobody's email or devices are sent." |
* | "ai_pending" | "Writing a draft…" |
* | "ai_marker" | "AI draft — review before sharing" |
* | "ai_marker_hint" | "Written by Workers AI from the timeline. Check every section; saving marks it as reviewed." |
* | "ai_failed_failed" | "The AI draft failed. Try again in a moment." |
* | "ai_failed_timeout" | "The AI draft took too long. Try again." |
* | "ai_failed_edited" | "Someone saved the postmortem while the AI was writing, so their text was kept." |
* | "ai_failed_unavailable" | "AI drafts aren't available right now." |
* | "ai_refused_limit_reached" | "This workspace asked for as many AI drafts as it can today. Try again tomorrow." |
* | "ai_refused_conflict" | "A draft is already being written, or the postmortem has text a member wrote." |
* | "ai_refused_ai_unavailable" | "AI drafts aren't set up on this server." |
* | "ai_refused_other" | "Couldn't ask for a draft: {reason}" |
* | "chars" | "{count} left" |
* | "read_only" | "Only responders, admins and owners edit the postmortem." |
* | * | "Postmortem" |
*
* @param {Postmortem_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const postmortem_text: ((inputs: Postmortem_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Postmortem_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
