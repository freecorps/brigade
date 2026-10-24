export type LocalizedString = import('../runtime.js').LocalizedString;
export type Stack_Database_SizeInputs = {};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} Stack_Database_SizeInputs */
/**
* | output |
* | --- |
* | "Database size" |
*
* @param {Stack_Database_SizeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const stack_database_size: ((inputs?: Stack_Database_SizeInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Database_SizeInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
