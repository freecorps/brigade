/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Member_Email_SettingsInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Email" |
* | "description" | "What Brigade emails you about in this workspace." |
* | "missed" | "Missed pages" |
* | "missed_hint" | "When a SEV1 or SEV2 page doesn't reach your phone, Brigade emails you, once per incident." |
* | "missed_workspace_off" | "Your workspace has turned these emails off for everyone." |
* | "reminders" | "Follow-up reminders" |
* | "reminders_hint" | "Each morning at 9:00 in your time zone, a list of your open follow-ups due that day or overdue. At most one email a day." |
* | "owners_note" | "Owners always get the email when a page reached nobody, whatever they choose here: it's the fallback when paging fails." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save your choice. Try again." |
* | "loading" | "Loading your choices…" |
* | "load_failed" | "Couldn't load your choices." |
* | "on" | "On" |
* | "off" | "Off" |
* | * | "Email" |
*
* @param {Member_Email_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const member_email_settings = /** @type {((inputs: Member_Email_SettingsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Email_SettingsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Email`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Sobre o que o Brigade envia email para você neste workspace.`);
		if (i?.part === "missed") return /** @type {LocalizedString} */ (`Acionamentos perdidos`);
		if (i?.part === "missed_hint") return /** @type {LocalizedString} */ (`Quando um acionamento SEV1 ou SEV2 não chega ao seu celular, o Brigade envia um email para você, uma vez por incidente.`);
		if (i?.part === "missed_workspace_off") return /** @type {LocalizedString} */ (`Seu workspace desativou estes emails para todos.`);
		if (i?.part === "reminders") return /** @type {LocalizedString} */ (`Lembretes de ações`);
		if (i?.part === "reminders_hint") return /** @type {LocalizedString} */ (`Toda manhã às 9:00 no seu fuso horário, a lista das suas ações de acompanhamento abertas com prazo no dia ou atrasadas. No máximo um email por dia.`);
		if (i?.part === "owners_note") return /** @type {LocalizedString} */ (`Proprietários sempre recebem o email quando um acionamento não chegou a ninguém, seja qual for a escolha aqui: é o último recurso quando o acionamento falha.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível salvar sua escolha. Tente de novo.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando suas escolhas…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar suas escolhas.`);
		if (i?.part === "on") return /** @type {LocalizedString} */ (`Ativado`);
		if (i?.part === "off") return /** @type {LocalizedString} */ (`Desativado`);
		return /** @type {LocalizedString} */ (`Email`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Email`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`What Brigade emails you about in this workspace.`);
		if (i?.part === "missed") return /** @type {LocalizedString} */ (`Missed pages`);
		if (i?.part === "missed_hint") return /** @type {LocalizedString} */ (`When a SEV1 or SEV2 page doesn't reach your phone, Brigade emails you, once per incident.`);
		if (i?.part === "missed_workspace_off") return /** @type {LocalizedString} */ (`Your workspace has turned these emails off for everyone.`);
		if (i?.part === "reminders") return /** @type {LocalizedString} */ (`Follow-up reminders`);
		if (i?.part === "reminders_hint") return /** @type {LocalizedString} */ (`Each morning at 9:00 in your time zone, a list of your open follow-ups due that day or overdue. At most one email a day.`);
		if (i?.part === "owners_note") return /** @type {LocalizedString} */ (`Owners always get the email when a page reached nobody, whatever they choose here: it's the fallback when paging fails.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't save your choice. Try again.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading your choices…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load your choices.`);
		if (i?.part === "on") return /** @type {LocalizedString} */ (`On`);
		if (i?.part === "off") return /** @type {LocalizedString} */ (`Off`);
		return /** @type {LocalizedString} */ (`Email`)
	}
});