/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Ack_Signed_OutInputs */



/**
* | output |
* | --- |
* | "Couldn't acknowledge: sign in to Brigade first." |
*
* @param {Push_Ack_Signed_OutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_ack_signed_out = /** @type {((inputs?: Push_Ack_Signed_OutInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_Signed_OutInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível confirmar: entre no Brigade primeiro.")
	return /** @type {LocalizedString} */ ("Couldn't acknowledge: sign in to Brigade first.")
});