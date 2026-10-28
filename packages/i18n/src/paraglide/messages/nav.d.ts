export type LocalizedString = import('../runtime.js').LocalizedString;
export type NavInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} NavInputs */
/**
* | part | output |
* | --- | --- |
* | "label" | "Dashboard" |
* | "respond" | "Respond" |
* | "configure" | "Configure" |
* | "overview" | "Overview" |
* | "incidents" | "Incidents" |
* | "follow_ups" | "Follow-ups" |
* | "on_call" | "On call" |
* | "monitors" | "Monitors" |
* | "services" | "Services" |
* | "escalation" | "Escalation" |
* | "alerts" | "Alerts" |
* | "integrations" | "Integrations" |
* | "status_page" | "Status page" |
* | "members" | "Members" |
* | "settings" | "Workspace settings" |
* | "account" | "Your account" |
* | "open" | "Open menu" |
* | "close" | "Close menu" |
* | "menu" | "Menu" |
* | * | "Brigade" |
*
* @param {NavInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const nav: ((inputs: NavInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<NavInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
