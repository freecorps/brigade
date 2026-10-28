/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ language: NonNullable<unknown> }} Slack_Language_WorkspaceInputs */



/**
* | output |
* | --- |
* | "Channel messages are written in the workspace's language: {language}." |
*
* @param {Slack_Language_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const slack_language_workspace = /** @type {((inputs: Slack_Language_WorkspaceInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_Language_WorkspaceInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`As mensagens no canal são escritas no idioma do espaço de trabalho: ${i?.language}.`)
	return /** @type {LocalizedString} */ (`Channel messages are written in the workspace's language: ${i?.language}.`)
});