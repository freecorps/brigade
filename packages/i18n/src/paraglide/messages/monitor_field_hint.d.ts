export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Field_HintInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_HintInputs */
/**
* | field | output |
* | --- | --- |
* | "url" | "Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it." |
* | "expected_status" | "Empty: any 2xx or 3xx. Or list them: 200, 204, 500-599. Redirects are not followed." |
* | "host" | "Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP." |
* | "port" | "Any port but 25." |
* | "timeout" | "How long one check may take." |
* | "timeout_tcp" | "How long the connection may take to open." |
* | "policy" | "An incident this monitor opens pages through this policy." |
* | "keyword_regex" | "A regular expression, without lookarounds or backreferences. Start it with (?i) to ignore case." |
* | "headers" | "Sent with every check. Everyone in the workspace, viewers too, can see them: Host, Authorization, Cookie and other credentials can't go here." |
* | "severity" | "The severity of the incident it opens." |
* | "quorum" | "How many of its regions must see it down to open an incident, and up to resolve it." |
* | "consecutive" | "Checks a region must fail in a row before it counts as down, and pass to count as up. Empty: 2." |
* | * | "How late a ping may be before it counts as missed." |
*
* @param {Monitor_Field_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_field_hint: ((inputs: Monitor_Field_HintInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_HintInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
