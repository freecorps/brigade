/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Ack_InactiveInputs */



/**
* | output |
* | --- |
* | "This incident is no longer active, so there is nothing to acknowledge." |
*
* @param {Push_Ack_InactiveInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_ack_inactive = /** @type {((inputs?: Push_Ack_InactiveInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_InactiveInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Este incidente não está mais ativo, então não há o que confirmar.")
	return /** @type {LocalizedString} */ ("This incident is no longer active, so there is nothing to acknowledge.")
});