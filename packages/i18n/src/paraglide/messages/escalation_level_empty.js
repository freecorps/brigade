/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_Level_EmptyInputs */



/**
* | output |
* | --- |
* | "Nobody to page at this level: it is skipped until someone is added" |
*
* @param {Escalation_Level_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_level_empty = /** @type {((inputs?: Escalation_Level_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Level_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Ninguém para chamar neste nível: ele é pulado até alguém ser adicionado")
	return /** @type {LocalizedString} */ ("Nobody to page at this level: it is skipped until someone is added")
});