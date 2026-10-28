/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Ended_AcknowledgedInputs */



/**
* | output |
* | --- |
* | "Acknowledged. The call ended." |
*
* @param {Call_Ended_AcknowledgedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_ended_acknowledged = /** @type {((inputs?: Call_Ended_AcknowledgedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Ended_AcknowledgedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Confirmado. A chamada terminou.")
	return /** @type {LocalizedString} */ ("Acknowledged. The call ended.")
});