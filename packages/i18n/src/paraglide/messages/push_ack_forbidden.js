/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Ack_ForbiddenInputs */



/**
* | output |
* | --- |
* | "You can no longer acknowledge incidents in this workspace." |
*
* @param {Push_Ack_ForbiddenInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_ack_forbidden = /** @type {((inputs?: Push_Ack_ForbiddenInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Ack_ForbiddenInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Você não pode mais confirmar incidentes neste espaço de trabalho.")
	return /** @type {LocalizedString} */ ("You can no longer acknowledge incidents in this workspace.")
});