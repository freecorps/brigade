/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Workspace_LanguageInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Workspace language" |
* | "description" | "The language Brigade writes shared text in: the titles of incidents monitors and alert sources open, Slack channel messages and AI postmortem drafts. Emails ..." |
* | "label" | "Language" |
* | "hint" | "Only owners can change it. Text already written stays as it is." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save the language. Try again." |
* | "loading" | "Loading the language…" |
* | "load_failed" | "Couldn't load the workspace language." |
* | * | "Workspace language" |
*
* @param {Workspace_LanguageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_language = /** @type {((inputs: Workspace_LanguageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_LanguageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Idioma do espaço de trabalho`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`O idioma em que o Brigade escreve textos compartilhados: os títulos dos incidentes abertos por monitores e fontes de alertas, as mensagens nos canais do Slack e os rascunhos de postmortem feitos com IA. Emails e notificações para cada pessoa continuam no idioma dela.`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Idioma`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Só proprietários podem mudar. O que já foi escrito continua como está.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível salvar o idioma. Tente de novo.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando o idioma…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar o idioma do espaço de trabalho.`);
		return /** @type {LocalizedString} */ (`Idioma do espaço de trabalho`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Workspace language`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`The language Brigade writes shared text in: the titles of incidents monitors and alert sources open, Slack channel messages and AI postmortem drafts. Emails and notifications to each person stay in their own language.`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Language`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Only owners can change it. Text already written stays as it is.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't save the language. Try again.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading the language…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the workspace language.`);
		return /** @type {LocalizedString} */ (`Workspace language`)
	}
});