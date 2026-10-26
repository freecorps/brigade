/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Member_RemoveInputs */



/**
* | output |
* | --- |
* | "Remove {name} from the layer" |
*
* @param {Oncall_Member_RemoveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_member_remove = /** @type {((inputs: Oncall_Member_RemoveInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Member_RemoveInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Tirar ${i?.name} da camada`)
	return /** @type {LocalizedString} */ (`Remove ${i?.name} from the layer`)
});