export type LocalizedString = import('../runtime.js').LocalizedString;
export type Oncall_MineInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_MineInputs */
/**
* | part | output |
* | --- | --- |
* | "on_call" | "You're on call" |
* | "off_call" | "You're not on call" |
* | "status_until" | "On call until {time}" |
* | "status_next" | "Not on call · next shift {time}" |
* | "status_none" | "Not on call in the next 4 weeks" |
* | "open_hint" | "Opens your shifts and who is on call" |
* | "you_name" | "{name} (you)" |
* | "next" | "Your next shifts" |
* | "next_none" | "No shifts in the next 4 weeks" |
* | "overrides" | "Your overrides" |
* | "remove_mine" | "Remove your override on {name}?" |
* | "workspace" | "In {name}" |
* | "elsewhere" | "You're on call in {name} until {time}" |
* | "elsewhere_open" | "You're on call in {name}" |
* | * | "Schedules and rotations are edited on the dashboard." |
*
* @param {Oncall_MineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const oncall_mine: ((inputs: Oncall_MineInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_MineInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
