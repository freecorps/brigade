export type LocalizedString = import('../runtime.js').LocalizedString;
export type Account_Menu_LabelInputs = {
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ name: NonNullable<unknown> }} Account_Menu_LabelInputs */
/**
* | output |
* | --- |
* | "Account: {name}" |
*
* @param {Account_Menu_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const account_menu_label: ((inputs: Account_Menu_LabelInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Account_Menu_LabelInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
