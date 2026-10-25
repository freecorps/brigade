/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ shard: NonNullable<unknown> }} Push_RegisteredInputs */



/**
* | output |
* | --- |
* | "Registered on {shard}" |
*
* @param {Push_RegisteredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_registered = /** @type {((inputs: Push_RegisteredInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_RegisteredInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Registrado em ${i?.shard}`)
	return /** @type {LocalizedString} */ (`Registered on ${i?.shard}`)
});