/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Workspace_Email_SettingsInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Email when paging fails" |
* | "description" | "Who Brigade emails when a page doesn't get through. Both are on by default." |
* | "unpaged" | "Tell members a page missed them" |
* | "unpaged_hint" | "Email a member when a SEV1 or SEV2 page didn't reach their phone, once per incident. Each member can also turn this off for themselves." |
* | "nobody" | "Tell owners when a page reached nobody" |
* | "nobody_hint" | "Email the owners when a page reached nobody and nothing else will page. It's the fallback when paging fails, so members can't turn it off for themselves." |
* | "nobody_off" | "While this is off, nobody hears of a page that reached nobody until they open Brigade." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save the setting. Try again." |
* | "loading" | "Loading the settings…" |
* | "load_failed" | "Couldn't load the settings." |
* | * | "Email when paging fails" |
*
* @param {Workspace_Email_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const workspace_email_settings = /** @type {((inputs: Workspace_Email_SettingsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Workspace_Email_SettingsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Email quando o acionamento falha`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Quem o Brigade avisa por email quando um acionamento não chega. Os dois vêm ativados.`);
		if (i?.part === "unpaged") return /** @type {LocalizedString} */ (`Avisar o membro que um acionamento não chegou`);
		if (i?.part === "unpaged_hint") return /** @type {LocalizedString} */ (`Envia email a um membro quando um acionamento SEV1 ou SEV2 não chegou ao celular dele, uma vez por incidente. Cada membro também pode desativar isso para si.`);
		if (i?.part === "nobody") return /** @type {LocalizedString} */ (`Avisar os proprietários quando um acionamento não chegou a ninguém`);
		if (i?.part === "nobody_hint") return /** @type {LocalizedString} */ (`Envia email aos proprietários quando um acionamento não chegou a ninguém e nada mais vai acionar. É o último recurso quando o acionamento falha, então os membros não podem desativá-lo para si.`);
		if (i?.part === "nobody_off") return /** @type {LocalizedString} */ (`Enquanto isto estiver desativado, ninguém fica sabendo de um acionamento que não chegou a ninguém até abrir o Brigade.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível salvar a configuração. Tente de novo.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando as configurações…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar as configurações.`);
		return /** @type {LocalizedString} */ (`Email quando o acionamento falha`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Email when paging fails`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Who Brigade emails when a page doesn't get through. Both are on by default.`);
		if (i?.part === "unpaged") return /** @type {LocalizedString} */ (`Tell members a page missed them`);
		if (i?.part === "unpaged_hint") return /** @type {LocalizedString} */ (`Email a member when a SEV1 or SEV2 page didn't reach their phone, once per incident. Each member can also turn this off for themselves.`);
		if (i?.part === "nobody") return /** @type {LocalizedString} */ (`Tell owners when a page reached nobody`);
		if (i?.part === "nobody_hint") return /** @type {LocalizedString} */ (`Email the owners when a page reached nobody and nothing else will page. It's the fallback when paging fails, so members can't turn it off for themselves.`);
		if (i?.part === "nobody_off") return /** @type {LocalizedString} */ (`While this is off, nobody hears of a page that reached nobody until they open Brigade.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't save the setting. Try again.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading the settings…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the settings.`);
		return /** @type {LocalizedString} */ (`Email when paging fails`)
	}
});