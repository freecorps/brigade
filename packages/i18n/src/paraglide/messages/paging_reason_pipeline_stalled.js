/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Pipeline_StalledInputs */



/**
* | output |
* | --- |
* | "The self-check's heartbeat stopped getting through the event queue, or gets through minutes late." |
*
* @param {Paging_Reason_Pipeline_StalledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_pipeline_stalled = /** @type {((inputs?: Paging_Reason_Pipeline_StalledInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Pipeline_StalledInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O sinal da autoverificação parou de passar pela fila de eventos, ou passa com minutos de atraso.")
	return /** @type {LocalizedString} */ ("The self-check's heartbeat stopped getting through the event queue, or gets through minutes late.")
});