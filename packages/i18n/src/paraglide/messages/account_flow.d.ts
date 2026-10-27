export type LocalizedString = import('../runtime.js').LocalizedString;
export type Account_FlowInputs = {
    part: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Account_FlowInputs */
/**
* | part | output |
* | --- | --- |
* | "sign_up_taken" | "Couldn't sign you in. If this email already has an account, we've emailed its owner: sign in instead, or reset the password if it's yours." |
* | "switcher" | "Switch workspace" |
* | "workspaces" | "Workspaces" |
* | "current" | "Current workspace" |
* | "switch_to" | "Switch to {name}" |
* | "new_workspace" | "New workspace" |
* | "switching" | "Switching…" |
* | "switch_failed" | "Couldn't switch workspaces. Check your connection and try again." |
* | "list_failed" | "Couldn't load your workspaces." |
* | "new_title" | "Create a workspace" |
* | "new_description" | "You'll own it. Your other workspaces stay as they are, and you can switch between them any time." |
* | "cancel" | "Cancel" |
* | "mobile_paging" | "Pages reach this phone from each workspace you've opened on it, as listed under each one. Brigade keeps all of them registered until you sign out or leave th..." |
* | "no_workspace" | "Your account isn't in a workspace yet. Create one to get started, or ask an owner to invite you." |
* | "paging_not_opened" | "Not paged on this phone: switch to it once to get its pages here." |
* | "pages_notice_in" | "This phone isn't paging you in {name}" |
* | "paged_here" | "Paged on this phone" |
* | "sign_out_failed" | "Couldn't sign you out, so you're still signed in. Check your connection and try again." |
* | "sign_out_retry" | "Try signing out again" |
* | * | "Brigade" |
*
* @param {Account_FlowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const account_flow: ((inputs: Account_FlowInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Account_FlowInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
