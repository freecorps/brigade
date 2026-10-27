export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_ReminderInputs = {
    part: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    title: NonNullable<unknown>;
    incident: NonNullable<unknown>;
    date: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, title: NonNullable<unknown>, incident: NonNullable<unknown>, date: NonNullable<unknown> }} Email_ReminderInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "Follow-ups due in {workspace}" |
* | "item" | "{title} ({incident}), due {date}" |
* | "item_overdue" | "{title} ({incident}), overdue since {date}" |
* | "open" | "Open your follow-ups" |
* | "off" | "To stop these reminders, turn off Follow-up reminders in the Email card on the dashboard, or under Email in the Brigade app's account settings." |
* | "settings" | "Email settings" |
* | "footer" | "You get this email because you own follow-ups in {workspace} on Brigade." |
* | * | "Follow-ups due in {workspace}" |
*
* @param {Email_ReminderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_reminder: ((inputs: Email_ReminderInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_ReminderInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
