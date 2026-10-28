/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_D1_FailingInputs */



/**
* | output |
* | --- |
* | "The database (D1) didn't answer a simple read." |
*
* @param {Paging_Reason_D1_FailingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_d1_failing = /** @type {((inputs?: Paging_Reason_D1_FailingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_D1_FailingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O banco de dados (D1) não respondeu a uma leitura simples.")
	return /** @type {LocalizedString} */ ("The database (D1) didn't answer a simple read.")
});