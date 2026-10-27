export type LocalizedString = import('../runtime.js').LocalizedString;
export type Postmortem_Template_TextInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, count: NonNullable<unknown> }} Postmortem_Template_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Postmortem templates" |
* | "note" | "The sections a new postmortem starts with, per incident type. A postmortem keeps the sections it was made with: editing a template or changing an incident's ..." |
* | "default_name" | "Workspace default" |
* | "default_note" | "For incidents with no type, or a type without its own template." |
* | "builtin" | "The seven built-in sections" |
* | "uses_default" | "Uses the workspace default" |
* | "sections" | "Sections: {name}" |
* | "edit" | "Edit template" |
* | "edit_on" | "Edit the postmortem template of {name}" |
* | "form_title" | "Postmortem template: {name}" |
* | "custom" | "Custom" |
* | "custom_name" | "Custom section {count}" |
* | "field_title" | "Title" |
* | "field_title_builtin" | "Leave empty to keep “{name}”." |
* | "field_title_invalid" | "A custom section needs a title." |
* | "field_hint" | "Hint" |
* | "field_hint_note" | "Shown to whoever writes the section, and given to the AI draft." |
* | "field_starter" | "Starter text" |
* | "field_starter_note" | "A new postmortem's editor starts with it." |
* | "field_invalid" | "Remove hidden characters, or write something visible." |
* | "add" | "Add section" |
* | "add_custom" | "Custom section" |
* | "limit" | "A template holds every built-in section and up to three custom ones." |
* | "move_up" | "Move {name} up" |
* | "move_down" | "Move {name} down" |
* | "remove" | "Remove {name}" |
* | "preview" | "Preview" |
* | "preview_note" | "What a new postmortem's editor shows." |
* | "save" | "Save template" |
* | "cancel" | "Cancel" |
* | "reset_type" | "Use the workspace default" |
* | "reset_default" | "Use the built-in sections" |
* | "reset_confirm" | "Stop using this template? New postmortems take {name}. Postmortems already written keep their sections." |
* | "reset_confirm_action" | "Stop using it" |
* | * | "Postmortem templates" |
*
* @param {Postmortem_Template_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const postmortem_template_text: ((inputs: Postmortem_Template_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Postmortem_Template_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
