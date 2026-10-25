/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Page_Title_Create_WorkspaceInputs */



/**
* | output |
* | --- |
* | "Create your workspace" |
*
* @param {Page_Title_Create_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const page_title_create_workspace = /** @type {((inputs?: Page_Title_Create_WorkspaceInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Title_Create_WorkspaceInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Crie seu espaço de trabalho")
	return /** @type {LocalizedString} */ ("Create your workspace")
});