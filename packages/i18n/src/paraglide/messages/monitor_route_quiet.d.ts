export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_Route_QuietInputs = {
    outcome: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ outcome: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_Route_QuietInputs */
/**
* | outcome | output |
* | --- | --- |
* | "suppressed" | "Kept quiet by route {name}: no incident" |
* | "dropped" | "Dropped by route {name}: nobody is paged" |
* | * | "Route: {name}" |
*
* @param {Monitor_Route_QuietInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_route_quiet: ((inputs: Monitor_Route_QuietInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Route_QuietInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
