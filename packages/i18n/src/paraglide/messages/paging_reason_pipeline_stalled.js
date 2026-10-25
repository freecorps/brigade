/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Pipeline_StalledInputs */



/**
* | output |
* | --- |
* | "Test pages stopped getting through the event queue." |
*
* @param {Paging_Reason_Pipeline_StalledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_pipeline_stalled = /** @type {((inputs?: Paging_Reason_Pipeline_StalledInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Pipeline_StalledInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Os acionamentos de teste pararam de passar pela fila de eventos.")
	return /** @type {LocalizedString} */ ("Test pages stopped getting through the event queue.")
});