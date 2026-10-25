/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Workspace_Create_DescriptionInputs */



/**
* | output |
* | --- |
* | "Incidents and the people who handle them live in a workspace." |
*
* @param {Workspace_Create_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_create_description = /** @type {((inputs?: Workspace_Create_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Create_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Os incidentes e as pessoas que cuidam deles ficam em um espaço de trabalho.")
	return /** @type {LocalizedString} */ ("Incidents and the people who handle them live in a workspace.")
});