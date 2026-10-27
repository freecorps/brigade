export type LocalizedString = import('../runtime.js').LocalizedString;
export type Monitor_PolicyInputs = {
    kind: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ kind: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_PolicyInputs */
/**
* | kind | output |
* | --- | --- |
* | "own" | "Pages through {name}" |
* | "default" | "Pages through {name} (default)" |
* | "none" | "No escalation policy" |
* | "option_default" | "Workspace default ({name})" |
* | "option_none" | "Workspace default (none set)" |
* | * | "{name}" |
*
* @param {Monitor_PolicyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const monitor_policy: ((inputs: Monitor_PolicyInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_PolicyInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
