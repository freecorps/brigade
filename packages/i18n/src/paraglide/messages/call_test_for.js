/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ incident: NonNullable<unknown> }} Call_Test_ForInputs */



/**
* | output |
* | --- |
* | "For {incident}" |
*
* @param {Call_Test_ForInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_test_for = /** @type {((inputs: Call_Test_ForInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_ForInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Para ${i?.incident}`)
	return /** @type {LocalizedString} */ (`For ${i?.incident}`)
});