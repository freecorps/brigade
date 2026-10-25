/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Script_PromptInputs */



/**
* | output |
* | --- |
* | "Press 1 to acknowledge, or hang up to pass the page on." |
*
* @param {Call_Script_PromptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_script_prompt = /** @type {((inputs?: Call_Script_PromptInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Script_PromptInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Pressione 1 para confirmar, ou desligue para passar o acionamento adiante.")
	return /** @type {LocalizedString} */ ("Press 1 to acknowledge, or hang up to pass the page on.")
});