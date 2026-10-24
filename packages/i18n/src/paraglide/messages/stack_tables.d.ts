export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_TablesInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_TablesInputs */
/**
* | output |
* | --- |
* | "SQLite tables" |
*
* @param {Stack_TablesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_tables: ((inputs?: Stack_TablesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_TablesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
