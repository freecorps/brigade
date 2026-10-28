export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_Domain_CardInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown> }} Status_Domain_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Custom domain" |
* | "description" | "Serve the status page at your own address, such as status.example.com. Cloudflare issues its certificate once the DNS records below are in place." |
* | "not_set_up" | "Set up the status page first to give it a domain." |
* | "none" | "The status page has no domain of its own." |
* | "viewer" | "Owners and admins can add or remove the domain." |
* | "hostname_label" | "Domain" |
* | "hostname_hint" | "A subdomain you control. Point a CNAME at {name}." |
* | "add" | "Add domain" |
* | "adding" | "Adding…" |
* | "state_pending" | "Pending" |
* | "state_active" | "Active" |
* | "state_failed" | "Failed" |
* | "explain_pending" | "Create these DNS records where your domain is hosted, then check again. It can take a few minutes after the records are in place." |
* | "explain_active" | "The status page is served at this domain." |
* | "explain_failed" | "Cloudflare couldn't verify the domain. Check the records, then check again, or remove the domain and add it again." |
* | "records_title" | "DNS records to create" |
* | "record_name" | "Name" |
* | "record_value" | "Value" |
* | "checked" | "Last checked {time}" |
* | "check" | "Check again" |
* | "checking" | "Checking…" |
* | "remove" | "Remove domain" |
* | "removing" | "Removing…" |
* | "keep" | "Keep" |
* | "remove_confirm" | "Remove {name}? The status page stops answering there right away; its usual address keeps working." |
* | "error_required" | "Enter a domain." |
* | "error_invalid_hostname" | "That isn't a domain. Enter a name like status.example.com, without https:// or a path." |
* | "error_own_domain" | "That domain belongs to this Brigade instance. Use one of your own." |
* | "error_hostname_taken" | "That domain is already in use by another status page." |
* | "error_domain_exists" | "The status page already has a domain. Remove it first." |
* | "error_not_configured" | "This Brigade instance has no custom domains set up." |
* | "error_forbidden" | "Only owners and admins can change the domain." |
* | "error_rate_limited" | "Too many changes in a minute. Try again shortly." |
* | "error_not_found" | "The domain is no longer on the status page." |
* | "error_cloudflare_failed" | "Cloudflare didn't answer. Try again in a minute." |
* | "error_failed" | "Couldn't save. Try again." |
* | * | "Custom domain" |
*
* @param {Status_Domain_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_domain_card: ((inputs: Status_Domain_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_Domain_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
