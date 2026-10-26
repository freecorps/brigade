/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Override_RemoveInputs */



/**
* | output |
* | --- |
* | "Remove override for {name}" |
*
* @param {Oncall_Override_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_override_remove = /** @type {((inputs: Oncall_Override_RemoveInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Override_RemoveInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Remover a substituição de ${i?.name}`)
	return /** @type {LocalizedString} */ (`Remove override for ${i?.name}`)
});