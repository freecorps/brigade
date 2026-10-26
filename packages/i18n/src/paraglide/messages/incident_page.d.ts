export type LocalizedString = import('../runtime.js').LocalizedString;
export type Incident_PageInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Incident_PageInputs */
/**
* | part | output |
* | --- | --- |
* | "back" | "All incidents" |
* | "loading" | "Loading the incident…" |
* | "not_found" | "There is no incident with this number in this workspace." |
* | "roles" | "Roles" |
* | "timeline" | "Timeline" |
* | "timeline_empty" | "Nothing on the timeline yet." |
* | "update_label" | "Post an update" |
* | "update_placeholder" | "What do you know now? What happens next?" |
* | "update_hint" | "Everyone in the workspace sees it on the timeline." |
* | "update_empty" | "Write the update first." |
* | "update_invalid" | "Remove invisible, control or bidi characters and try again." |
* | "post" | "Post update" |
* | "nobody" | "Unassigned" |
* | "unassign" | "Unassign" |
* | "no_members" | "Teammates show up here once they have opened Brigade." |
* | "you" | "You" |
* | "you_object" | "you" |
* | "monitors" | "A monitor" |
* | "teammate" | "A teammate" |
* | "read_only" | "Viewers follow the incident; responders and admins change it." |
* | "not_found_title" | "Incident not found" |
* | "load_failed_title" | "Couldn't load the incident" |
* | "unnamed" | "Unnamed member" |
* | "show_more" | "Show more" |
* | "show_less" | "Show less" |
* | "show_names" | "Show names" |
* | "hide_names" | "Hide names" |
* | * | "Incident" |
*
* @param {Incident_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const incident_page: ((inputs: Incident_PageInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_PageInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
