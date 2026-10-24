/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

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
export const intl_engine = /** @type {((inputs: Intl_EngineInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_EngineInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Motor: ${i?.engine}`)
	return /** @type {LocalizedString} */ (`Engine: ${i?.engine}`)
});