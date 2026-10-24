/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ ms: NonNullable<unknown> }} Stack_LatencyInputs */



/**
* | output |
* | --- |
* | "{ms} ms round trip" |
*
* @param {Stack_LatencyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_latency = /** @type {((inputs: Stack_LatencyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_LatencyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`${i?.ms} ms de ida e volta`)
	return /** @type {LocalizedString} */ (`${i?.ms} ms round trip`)
});