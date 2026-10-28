export type LocalizedString = import('../runtime.js').LocalizedString;
export type Devices_CardInputs = {
    part: NonNullable<unknown>;
    max: NonNullable<unknown>;
    suffix: NonNullable<unknown>;
    when: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, max: NonNullable<unknown>, suffix: NonNullable<unknown>, when: NonNullable<unknown>, name: NonNullable<unknown> }} Devices_CardInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Your phones" |
* | "description" | "The phones where the Brigade app pages you in this workspace, up to {max}. A new phone past that replaces the one heard from least recently. Everyone in the ..." |
* | "loading" | "Loading your phones…" |
* | "load_failed" | "Couldn't load your phones." |
* | "empty" | "No phone pages you here yet. Sign in on the Brigade app on your phone to get pages." |
* | "platform_ios" | "iPhone" |
* | "platform_android" | "Android phone" |
* | "env_production" | "App Store or TestFlight build" |
* | "env_sandbox" | "Development build" |
* | "id" | "ID ending {suffix}" |
* | "registered" | "Registered {when}" |
* | "seen" | "Last heard from {when}" |
* | "seen_hint" | "The last time the app registered this phone, even with nothing new to send, or the phone confirmed it showed a page" |
* | "calls_on" | "Rings as a call" |
* | "calls_off" | "Notifications only" |
* | "remove" | "Remove" |
* | "remove_label" | "Remove {name}" |
* | "remove_confirm" | "Stop paging this {name}? If the Brigade app is still signed in on it, it registers again as soon as the app is open: sign out in the app to stop it for good." |
* | "remove_go" | "Remove phone" |
* | "removing" | "Removing…" |
* | "keep" | "Keep" |
* | "remove_failed" | "Couldn't remove this phone. Try again." |
* | * | "Your phones" |
*
* @param {Devices_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const devices_card: ((inputs: Devices_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Devices_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
