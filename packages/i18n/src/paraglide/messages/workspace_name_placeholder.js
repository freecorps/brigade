/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Workspace_Name_PlaceholderInputs */



/**
* | output |
* | --- |
* | "Platform team" |
*
* @param {Workspace_Name_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_name_placeholder = /** @type {((inputs?: Workspace_Name_PlaceholderInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Name_PlaceholderInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Time de plataforma")
	return /** @type {LocalizedString} */ ("Platform team")
});