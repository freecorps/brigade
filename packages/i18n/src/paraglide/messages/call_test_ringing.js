/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Test_RingingInputs */



/**
* | output |
* | --- |
* | "Lock the phone now: it rings in 10 seconds." |
*
* @param {Call_Test_RingingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_test_ringing = /** @type {((inputs?: Call_Test_RingingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_RingingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Bloqueie o telefone agora: ele toca em 10 segundos.")
	return /** @type {LocalizedString} */ ("Lock the phone now: it rings in 10 seconds.")
});