export type LocalizedString = import('../runtime.js').LocalizedString;
export type Email_RotationInputs = {
    part: NonNullable<unknown>;
    workspace: NonNullable<unknown>;
    member: NonNullable<unknown>;
    schedule: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, member: NonNullable<unknown>, schedule: NonNullable<unknown> }} Email_RotationInputs */
/**
* | part | output |
* | --- | --- |
* | "subject" | "{member} was taken out of on-call schedules in {workspace}" |
* | "intro_removed" | "{member} was removed from {workspace}, so Brigade took them out of these on-call schedules:" |
* | "intro_left" | "{member} left {workspace}, so Brigade took them out of these on-call schedules:" |
* | "intro_viewer" | "{member} is now a viewer in {workspace}, and viewers aren't on call, so Brigade took them out of these on-call schedules:" |
* | "item" | "{schedule}" |
* | "item_emptied" | "{schedule}: one of its layers has nobody in it now" |
* | "how" | "The others in each rotation moved up to cover the shifts, and their overrides were deleted. Check that the new handoffs suit everyone." |
* | "someone" | "A member" |
* | "open" | "Open the schedules" |
* | "footer" | "You get this email because you're an owner of {workspace} on Brigade." |
* | * | "{member} was taken out of on-call schedules in {workspace}" |
*
* @param {Email_RotationInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const email_rotation: ((inputs: Email_RotationInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_RotationInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
