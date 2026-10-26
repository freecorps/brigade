/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Ack_Not_FoundInputs */



/**
* | output |
* | --- |
* | "This incident is no longer in Brigade." |
*
* @param {Push_Ack_Not_FoundInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_ack_not_found = /** @type {((inputs?: Push_Ack_Not_FoundInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_Not_FoundInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Este incidente não está mais no Brigade.")
	return /** @type {LocalizedString} */ ("This incident is no longer in Brigade.")
});