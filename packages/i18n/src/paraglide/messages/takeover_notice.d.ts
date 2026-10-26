export type LocalizedString = import('../runtime.js').LocalizedString;
export type Takeover_NoticeInputs = {
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown> }} Takeover_NoticeInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "You took this account back" |
* | "body" | "Someone signed up with your email address before you confirmed it, and created the workspaces below. They're yours now. So nobody else can page you through w..." |
* | "after" | "Resume the monitors you want to keep. Give each heartbeat you keep a new URL with New URL in its Edit form. Check each workspace's on-call schedules and esca..." |
* | "failed" | "Brigade couldn't reach this workspace, so nothing in it was paused. Check its monitors now." |
* | "nothing" | "It had no monitors." |
* | "dismiss" | "Got it" |
* | "dismissing" | "Hiding…" |
* | "dismiss_failed" | "Couldn't hide this notice. Try again." |
* | * | "You took this account back" |
*
* @param {Takeover_NoticeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const takeover_notice: ((inputs: Takeover_NoticeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_NoticeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
