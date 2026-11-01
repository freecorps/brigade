/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Handles_UnavailableInputs */



/**
* | output |
* | --- |
* | "The push relay can't page phones registered through it (it predates them, or its handle keys aren't set), so those phones can't be paged." |
*
* @param {Paging_Reason_Relay_Handles_UnavailableInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_handles_unavailable = /** @type {((inputs?: Paging_Reason_Relay_Handles_UnavailableInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Handles_UnavailableInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push não consegue acionar celulares registrados por ele (é anterior a eles, ou suas chaves de identificadores não estão configuradas), então esses celulares não podem ser acionados.")
	return /** @type {LocalizedString} */ ("The push relay can't page phones registered through it (it predates them, or its handle keys aren't set), so those phones can't be paged.")
});