/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_No_BeatInputs */



/**
* | output |
* | --- |
* | "The minute self-check stopped running." |
*
* @param {Paging_Reason_No_BeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_no_beat = /** @type {((inputs?: Paging_Reason_No_BeatInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_No_BeatInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A autoverificação de cada minuto parou de rodar.")
	return /** @type {LocalizedString} */ ("The minute self-check stopped running.")
});