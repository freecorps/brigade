/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ language: NonNullable<unknown> }} Workspace_Language_ReadInputs */



/**
* | output |
* | --- |
* | "Brigade writes this workspace's shared text in {language}. An owner can change it." |
*
* @param {Workspace_Language_ReadInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_language_read = /** @type {((inputs: Workspace_Language_ReadInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Language_ReadInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`O Brigade escreve os textos compartilhados deste espaço de trabalho em ${i?.language}. Um proprietário pode mudar isso.`)
	return /** @type {LocalizedString} */ (`Brigade writes this workspace's shared text in ${i?.language}. An owner can change it.`)
});