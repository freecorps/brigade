/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Call_SettingsInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Calls" |
* | "description" | "On an iPhone with the Brigade app, an urgent page can also ring like a phone call, right after its notification. Choose which pages ring. The notification al..." |
* | "legend" | "Which pages ring as a call" |
* | "sev1_sev2" | "SEV1 pages and SEV2 escalations" |
* | "sev1_sev2_hint" | "Default. A SEV2 rings only when a level escalates because nobody acknowledged." |
* | "sev1" | "SEV1 pages only" |
* | "sev1_hint" | "SEV2 escalations come as notifications." |
* | "never" | "Never" |
* | "never_hint" | "Every page comes as a notification only." |
* | "saving" | "Saving…" |
* | "saved" | "Saved" |
* | "failed" | "Couldn't save your choice. Try again." |
* | "loading" | "Loading your choice…" |
* | "load_failed" | "Couldn't load your choice." |
* | "sheet_title" | "Which pages ring as a call?" |
* | * | "Calls" |
*
* @param {Call_SettingsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_settings = /** @type {((inputs: Call_SettingsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_SettingsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Chamadas`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Em um iPhone com o app do Brigade, um acionamento urgente também pode tocar como uma ligação, logo depois da notificação. Escolha quais acionamentos tocam. A notificação sempre chega.`);
		if (i?.part === "legend") return /** @type {LocalizedString} */ (`Quais acionamentos tocam como chamada`);
		if (i?.part === "sev1_sev2") return /** @type {LocalizedString} */ (`Acionamentos SEV1 e escalonamentos SEV2`);
		if (i?.part === "sev1_sev2_hint") return /** @type {LocalizedString} */ (`Padrão. Um SEV2 só toca quando um nível escala porque ninguém reconheceu.`);
		if (i?.part === "sev1") return /** @type {LocalizedString} */ (`Só acionamentos SEV1`);
		if (i?.part === "sev1_hint") return /** @type {LocalizedString} */ (`Escalonamentos SEV2 chegam como notificações.`);
		if (i?.part === "never") return /** @type {LocalizedString} */ (`Nunca`);
		if (i?.part === "never_hint") return /** @type {LocalizedString} */ (`Todo acionamento chega só como notificação.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível salvar sua escolha. Tente de novo.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando sua escolha…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar sua escolha.`);
		if (i?.part === "sheet_title") return /** @type {LocalizedString} */ (`Quais acionamentos tocam como chamada?`);
		return /** @type {LocalizedString} */ (`Chamadas`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Calls`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`On an iPhone with the Brigade app, an urgent page can also ring like a phone call, right after its notification. Choose which pages ring. The notification always comes.`);
		if (i?.part === "legend") return /** @type {LocalizedString} */ (`Which pages ring as a call`);
		if (i?.part === "sev1_sev2") return /** @type {LocalizedString} */ (`SEV1 pages and SEV2 escalations`);
		if (i?.part === "sev1_sev2_hint") return /** @type {LocalizedString} */ (`Default. A SEV2 rings only when a level escalates because nobody acknowledged.`);
		if (i?.part === "sev1") return /** @type {LocalizedString} */ (`SEV1 pages only`);
		if (i?.part === "sev1_hint") return /** @type {LocalizedString} */ (`SEV2 escalations come as notifications.`);
		if (i?.part === "never") return /** @type {LocalizedString} */ (`Never`);
		if (i?.part === "never_hint") return /** @type {LocalizedString} */ (`Every page comes as a notification only.`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't save your choice. Try again.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading your choice…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load your choice.`);
		if (i?.part === "sheet_title") return /** @type {LocalizedString} */ (`Which pages ring as a call?`);
		return /** @type {LocalizedString} */ (`Calls`)
	}
});