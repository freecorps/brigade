/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Pipeline_SlowInputs */



/**
* | output |
* | --- |
* | "Test pages take more than two minutes to get through the event queue." |
*
* @param {Paging_Reason_Pipeline_SlowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_pipeline_slow = /** @type {((inputs?: Paging_Reason_Pipeline_SlowInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Pipeline_SlowInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Os acionamentos de teste levam mais de dois minutos para passar pela fila de eventos.")
	return /** @type {LocalizedString} */ ("Test pages take more than two minutes to get through the event queue.")
});