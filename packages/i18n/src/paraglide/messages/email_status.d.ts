export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_StatusInputs = {
    part: NonNullable<unknown>;
    page: NonNullable<unknown>;
    title: NonNullable<unknown>;
    status: NonNullable<unknown>;
    time: NonNullable<unknown>;
    until: NonNullable<unknown>;
    list: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, page: NonNullable<unknown>, title: NonNullable<unknown>, status: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown>, list: NonNullable<unknown> }} Email_StatusInputs */
/**
* | part | output |
* | --- | --- |
* | "confirm_subject" | "Confirm your subscription to {page}" |
* | "confirm_intro" | "Someone, hopefully you, asked for email updates from the {page} status page at this address." |
* | "confirm_open" | "Confirm subscription" |
* | "confirm_after" | "The link expires in 48 hours. If you didn't ask for this, ignore this email: you won't get anything else." |
* | "confirm_footer" | "You get this email because this address was entered on the {page} status page." |
* | "incident_created_subject" | "{page}: {title}" |
* | "incident_updated_subject" | "{page} update: {title}" |
* | "incident_resolved_subject" | "{page} resolved: {title}" |
* | "maintenance_scheduled_subject" | "{page} scheduled maintenance: {title}" |
* | "maintenance_started_subject" | "{page} maintenance started: {title}" |
* | "maintenance_ended_subject" | "{page} maintenance completed: {title}" |
* | "maintenance_cancelled_subject" | "{page} maintenance called off: {title}" |
* | "status" | "Status: {status}" |
* | "affects" | "Affects {list}" |
* | "window" | "{time} to {until} UTC" |
* | "started" | "The maintenance has started. It's planned to end {until} UTC." |
* | "ended" | "The maintenance is over." |
* | "cancelled" | "This maintenance won't happen." |
* | "open" | "View the status page" |
* | "footer" | "You get this email because you subscribed to updates from {page}." |
* | "manage" | "Manage your subscription" |
* | "unsubscribe" | "Unsubscribe" |
* | * | "{page}" |
*
* @param {Email_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_status: ((inputs: Email_StatusInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_StatusInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
