export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Reminder_IntroInputs = {
    count: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown>, workspace: NonNullable<unknown> }} Email_Reminder_IntroInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "You have {countFormatted} open follow-up due today or overdue in {workspace}:" |
* | * | "You have {countFormatted} open follow-ups due today or overdue in {workspace}:" |
*
* @param {Email_Reminder_IntroInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_reminder_intro: ((inputs: Email_Reminder_IntroInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Reminder_IntroInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
