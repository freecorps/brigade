/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stack_Hint_StartInputs */



/**
* | output |
* | --- |
* | "Start everything from the repository root, then check again:" |
*
* @param {Stack_Hint_StartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_hint_start = /** @type {((inputs?: Stack_Hint_StartInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Hint_StartInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Suba tudo a partir da raiz do repositório e verifique de novo:")
	return /** @type {LocalizedString} */ ("Start everything from the repository root, then check again:")
});