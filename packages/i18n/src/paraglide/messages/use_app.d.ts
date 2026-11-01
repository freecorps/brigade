export type LocalizedString = import('../runtime.js').LocalizedString;
export type Use_AppInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Use_AppInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Use the app" |
* | "description" | "Brigade on your phone, for this workspace." |
* | "checking" | "Checking which app pages you here…" |
* | "store" | "Install the Brigade app from the App Store or Google Play, sign in with this account and allow notifications. That's where your pages arrive." |
* | "store_no_push" | "The Brigade app from the App Store or Google Play signs in to this workspace, so you can follow incidents from your phone." |
* | "own" | "Pages here go to your company's own build of the Brigade app. The Brigade app in the App Store and Google Play can't get them." |
* | "own_link" | "Get your company's app" |
* | "own_no_link" | "Ask an owner or admin where to get it." |
* | "failed" | "Couldn't check which app pages you here. Try again in a minute." |
* | "install_title" | "Which app to install" |
* | "page_description" | "Brigade on your phone: install the app, then sign it in as you with a QR code from this page." |
* | "link_description" | "Install the Brigade app and sign it in with a QR code, with no password typed on the phone." |
* | "link_open" | "Set up the app" |
* | * | "Use the app" |
*
* @param {Use_AppInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const use_app: ((inputs: Use_AppInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Use_AppInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
