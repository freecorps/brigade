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
* | "expected_status" | "Empty: any 2xx or 3xx. Redirects are not followed." |
* | "host" | "Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP." |
* | "port" | "Any port but 25." |
* | "timeout" | "How long one check may take." |
* | "timeout_tcp" | "How long the connection may take to open." |
* | "policy" | "An incident this monitor opens pages through this policy." |
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
