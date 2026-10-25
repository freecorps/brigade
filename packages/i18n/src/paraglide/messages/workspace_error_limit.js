/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Workspace_Error_LimitInputs */



/**
* | output |
* | --- |
* | "You belong to as many workspaces as Brigade allows. Ask an owner to add you instead." |
*
* @param {Workspace_Error_LimitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_error_limit = /** @type {((inputs?: Workspace_Error_LimitInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Error_LimitInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Você já participa do máximo de espaços de trabalho. Peça a quem administra um deles para adicionar você.")
	return /** @type {LocalizedString} */ ("You belong to as many workspaces as Brigade allows. Ask an owner to add you instead.")
});