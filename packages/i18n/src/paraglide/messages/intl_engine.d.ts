export type LocalizedString = import('../runtime.js').LocalizedString;
export type Intl_EngineInputs = {
    engine: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ engine: NonNullable<unknown> }} Intl_EngineInputs */
/**
* | output |
* | --- |
* | "Engine: {engine}" |
*
* @param {Intl_EngineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const intl_engine: ((inputs: Intl_EngineInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_EngineInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
