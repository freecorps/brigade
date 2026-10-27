export type LocalizedString = import('../runtime.js').LocalizedString;
export type Export_TextInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    count: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Export_TextInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Export" |
* | "incident_action" | "Export JSON" |
* | "incident_hint" | "The incident, its timeline, updates, follow-ups and postmortem, as one JSON file. Owners and admins only." |
* | "card_title" | "Export incidents" |
* | "card_description" | "Download the incidents declared in a date range (UTC) as JSON: timelines, updates, follow-ups and postmortems. Files can be downloaded for 7 days." |
* | "from" | "From" |
* | "to" | "To" |
* | "create" | "Export" |
* | "creating" | "Exporting…" |
* | "ready" | "Export ready." |
* | "download" | "Download" |
* | "recent" | "Recent exports" |
* | "none" | "No exports yet." |
* | "expires" | "Expires {time}" |
* | "scope_incident" | "One incident" |
* | "scope_range" | "{name}" |
* | "failed_too_large" | "Too many incidents for one file. Pick a shorter range." |
* | "failed_limit_reached" | "Too many incidents for one file. Pick a shorter range." |
* | "failed_rate_limited" | "Too many exports this hour. Try again later." |
* | "failed_invalid_args" | "Pick a range of up to 366 days, the start before the end." |
* | "failed_exports_unavailable" | "Exports aren't set up on this server." |
* | "failed_other" | "Couldn't export: {reason}" |
* | * | "Export" |
*
* @param {Export_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const export_text: ((inputs: Export_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Export_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
