/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Channel_UpdatesInputs */



/**
* | output |
* | --- |
* | "Incident updates" |
*
* @param {Push_Channel_UpdatesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const push_channel_updates = /** @type {((inputs?: Push_Channel_UpdatesInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Channel_UpdatesInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Atualizações de incidentes")
	return /** @type {LocalizedString} */ ("Incident updates")
});