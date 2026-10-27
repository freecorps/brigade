export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_Reminder_MoreInputs = {
    count: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ count: NonNullable<unknown> }} Email_Reminder_MoreInputs */
/**
* | countPlural | output |
* | --- | --- |
* | "one" | "And {countFormatted} more." |
* | * | "And {countFormatted} more." |
*
* @param {Email_Reminder_MoreInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_reminder_more: ((inputs: Email_Reminder_MoreInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Reminder_MoreInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
