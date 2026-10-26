/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_DeleteInputs */



/**
* | output |
* | --- |
* | "Delete schedule" |
*
* @param {Oncall_DeleteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_delete = /** @type {((inputs?: Oncall_DeleteInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_DeleteInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Excluir escala")
	return /** @type {LocalizedString} */ ("Delete schedule")
});