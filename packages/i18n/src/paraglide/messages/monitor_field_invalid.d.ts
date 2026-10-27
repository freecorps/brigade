export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Field_InvalidInputs = {
    field: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_InvalidInputs */
/**
* | field | output |
* | --- | --- |
* | "name" | "Give the monitor a name." |
* | "url" | "Use a public http or https address, on a web port such as 80, 443, 8080 or 8443." |
* | "host" | "Use a public host name or IP address, without http:// or a port." |
* | "host_cloudflare" | "Cloudflare doesn't allow TCP checks of its own addresses. Use your server's address." |
* | "host_underscore" | "Host names can't contain underscores (_). Use a public host name or IP address." |
* | "port" | "Use a port from 1 to 65535." |
* | "port_blocked" | "Cloudflare blocks port 25. Use another port." |
* | "expected_status" | "Use statuses from 100 to 599, like 200, 204 or 500-599, or leave it empty." |
* | "keyword" | "Use at most 200 characters." |
* | "interval" | "Use whole seconds, from 30 to 86,400 (24 hours)." |
* | "timeout" | "Use 1 to 30 seconds, and no more than the interval." |
* | "grace" | "Use whole seconds, from 0 to 86,400 (24 hours)." |
* | "regions" | "Pick at least one region." |
* | "policy" | "That policy no longer exists. Pick another." |
* | "keyword_regex" | "This pattern isn't supported. Lookarounds, backreferences and word boundaries aren't, and repeat counts go up to 100." |
* | "headers" | "Fix the marked headers: each needs a name and a value of plain characters, no credentials, and no name twice." |
* | "quorum" | "Pick at most as many regions as it checks from." |
* | "consecutive" | "Use a whole number from 1 to 10, or leave it empty." |
* | * | "Check this value." |
*
* @param {Monitor_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_field_invalid: ((inputs: Monitor_Field_InvalidInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_InvalidInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
