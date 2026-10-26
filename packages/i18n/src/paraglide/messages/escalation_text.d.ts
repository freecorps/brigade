export type LocalizedString = import('../runtime.js').LocalizedString;
export type Escalation_TextInputs = {
    text: NonNullable<unknown>;
    name: NonNullable<unknown>;
    time: NonNullable<unknown>;
    level: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, level: NonNullable<unknown>, reason: NonNullable<unknown> }} Escalation_TextInputs */
/**
* | text | output |
* | --- | --- |
* | "title" | "Escalation" |
* | "empty" | "No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond." |
* | "no_default" | "No default policy: pages go to the incident's commander, or to everyone who can respond." |
* | "default_note" | "Every page, from a monitor or declared by hand, goes through the default policy." |
* | "default_badge" | "Default" |
* | "level" | "Level {level}" |
* | "level_empty" | "Nobody to page at this level: it is skipped until someone is added" |
* | "on_call" | "{name} on call now" |
* | "add_target_placeholder" | "Choose…" |
* | "delete_confirm" | "Delete {name}? Runs under way keep the levels they started with." |
* | "delete_default" | "It is the default: pages go back to the incident's commander, or to everyone who can respond." |
* | "change_failed" | "Couldn't change {name}: {reason}" |
* | "gone" | "The policy no longer exists." |
* | "dropped" | "People or schedules that are gone were taken out of this policy." |
* | "deleted_schedule" | "Deleted schedule" |
* | "hint" | "Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once." |
* | "next_label" | "Next" |
* | "paged_at" | "Paged {time}" |
* | "everyone" | "Everyone who can respond" |
* | "policy_named" | "Policy: {name}" |
* | "nobody_reached" | "Nobody reached" |
* | "target_schedule" | "Schedule" |
* | "target_member" | "Person" |
* | "group_schedules" | "Schedules (whoever is on call)" |
* | "group_people" | "People" |
* | * | "Escalation" |
*
* @param {Escalation_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const escalation_text: ((inputs: Escalation_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
