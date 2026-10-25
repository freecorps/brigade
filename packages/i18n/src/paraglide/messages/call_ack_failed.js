/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown> }} Call_Ack_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't acknowledge. {reason}" |
*
* @param {Call_Ack_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_ack_failed = /** @type {((inputs: Call_Ack_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Ack_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível confirmar. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't acknowledge. ${i?.reason}`)
});