export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_SubscribeInputs = {
    part: NonNullable<unknown>;
    email: NonNullable<unknown>;
    page: NonNullable<unknown>;
    list: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown>, page: NonNullable<unknown>, list: NonNullable<unknown> }} Status_SubscribeInputs */
/**
* | part | output |
* | --- | --- |
* | "form_title" | "Get email updates" |
* | "form_hint" | "We'll email you when an incident is posted here or maintenance is planned. You confirm from your inbox and can unsubscribe at any time." |
* | "email_label" | "Email address" |
* | "submit" | "Subscribe" |
* | "honeypot" | "Leave this field empty" |
* | "check_title" | "Check your inbox" |
* | "check_body" | "If {email} isn't subscribed to {page} yet, we've sent it a link to confirm. The link expires in 48 hours." |
* | "invalid_title" | "Check the address" |
* | "invalid_body" | "That doesn't look like an email address. Go back and try again." |
* | "limited_title" | "Too many requests" |
* | "limited_body" | "Too many subscriptions were asked for just now. Try again in a minute." |
* | "confirm_title" | "Confirm your subscription" |
* | "confirm_body" | "Confirm to get email updates from {page}." |
* | "confirm_button" | "Confirm subscription" |
* | "confirmed_title" | "You're subscribed" |
* | "confirmed_body" | "You'll get an email when {page} posts an incident or plans maintenance. Every email has a link to unsubscribe." |
* | "expired_title" | "This link has expired" |
* | "expired_body" | "Subscribe again from the status page to get a new one." |
* | "manage_title" | "Email updates" |
* | "manage_body" | "{email} gets email updates from {page}." |
* | "unsubscribe_button" | "Unsubscribe" |
* | "unsubscribed_title" | "You're unsubscribed" |
* | "unsubscribed_body" | "You won't get any more emails from {page}." |
* | "back" | "Back to the status page" |
* | "follow_toggle" | "Only some components (optional)" |
* | "follow_hint" | "Tick what you care about. Tick nothing to hear about everything. Incidents and maintenance that name no component reach every subscriber." |
* | "follow_group" | "The whole group, including components added later" |
* | "follow_ungrouped" | "Components" |
* | "manage_all" | "You hear about every incident and maintenance." |
* | "manage_some" | "You hear about incidents and maintenance on {list}, and about anything that names no component." |
* | "manage_gone" | "The components you followed are no longer on the page, so you hear about everything." |
* | "manage_choose" | "What you follow" |
* | "manage_cant_choose" | "To change what you follow, open this link again once the status page is back at this address." |
* | "follow_save" | "Save" |
* | "follow_all_button" | "Follow everything" |
* | "saved" | "Saved." |
* | * | "Email updates" |
*
* @param {Status_SubscribeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_subscribe: ((inputs: Status_SubscribeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_SubscribeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
