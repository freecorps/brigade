/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Workspace_Name_InvalidInputs */



/**
* | output |
* | --- |
* | "A name needs visible text: invisible characters alone don't count." |
*
* @param {Workspace_Name_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_name_invalid = /** @type {((inputs?: Workspace_Name_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O nome precisa de texto visível: só caracteres invisíveis não contam.")
	return /** @type {LocalizedString} */ ("A name needs visible text: invisible characters alone don't count.")
});