/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Not_ConfiguredInputs */



/**
* | output |
* | --- |
* | "No push relay is set up, so every page is recorded as failed." |
*
* @param {Paging_Reason_Relay_Not_ConfiguredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_not_configured = /** @type {((inputs?: Paging_Reason_Relay_Not_ConfiguredInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Not_ConfiguredInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nenhum relay de push está configurado, então todo acionamento é registrado como falho.")
	return /** @type {LocalizedString} */ ("No push relay is set up, so every page is recorded as failed.")
});