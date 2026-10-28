/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, max: NonNullable<unknown>, suffix: NonNullable<unknown>, when: NonNullable<unknown>, name: NonNullable<unknown> }} Devices_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Your phones" |
* | "description" | "The phones where the Brigade app pages you in this workspace, up to {max}. A new phone past that replaces the one heard from least recently. Everyone in the ..." |
* | "loading" | "Loading your phones…" |
* | "load_failed" | "Couldn't load your phones." |
* | "empty" | "No phone pages you here yet. Sign in on the Brigade app on your phone to get pages." |
* | "platform_ios" | "iPhone" |
* | "platform_android" | "Android phone" |
* | "env_production" | "App Store or TestFlight build" |
* | "env_sandbox" | "Development build" |
* | "id" | "ID ending {suffix}" |
* | "registered" | "Registered {when}" |
* | "seen" | "Last heard from {when}" |
* | "seen_hint" | "The last time the app registered this phone, even with nothing new to send, or the phone confirmed it showed a page" |
* | "calls_on" | "Rings as a call" |
* | "calls_off" | "Notifications only" |
* | "remove" | "Remove" |
* | "remove_label" | "Remove {name}" |
* | "remove_confirm" | "Stop paging this {name}? If the Brigade app is still signed in on it, it registers again as soon as the app is open: sign out in the app to stop it for good." |
* | "remove_go" | "Remove phone" |
* | "removing" | "Removing…" |
* | "keep" | "Keep" |
* | "remove_failed" | "Couldn't remove this phone. Try again." |
* | * | "Your phones" |
*
* @param {Devices_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const devices_card = /** @type {((inputs: Devices_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Devices_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Seus celulares`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Os celulares em que o app do Brigade aciona você neste workspace, até ${i?.max}. Um celular novo além disso substitui o que deu sinal há mais tempo. Todos no workspace veem esta lista, para entender por que alguém foi ou não acionado.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando seus celulares…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar seus celulares.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhum celular aciona você aqui ainda. Entre no app do Brigade no seu celular para receber acionamentos.`);
		if (i?.part === "platform_ios") return /** @type {LocalizedString} */ (`iPhone`);
		if (i?.part === "platform_android") return /** @type {LocalizedString} */ (`Celular Android`);
		if (i?.part === "env_production") return /** @type {LocalizedString} */ (`Versão da App Store ou TestFlight`);
		if (i?.part === "env_sandbox") return /** @type {LocalizedString} */ (`Versão de desenvolvimento`);
		if (i?.part === "id") return /** @type {LocalizedString} */ (`ID terminado em ${i?.suffix}`);
		if (i?.part === "registered") return /** @type {LocalizedString} */ (`Registrado ${i?.when}`);
		if (i?.part === "seen") return /** @type {LocalizedString} */ (`Último sinal ${i?.when}`);
		if (i?.part === "seen_hint") return /** @type {LocalizedString} */ (`A última vez que o app registrou este celular, mesmo sem nada novo a enviar, ou que o celular confirmou ter mostrado um acionamento`);
		if (i?.part === "calls_on") return /** @type {LocalizedString} */ (`Toca como chamada`);
		if (i?.part === "calls_off") return /** @type {LocalizedString} */ (`Só notificações`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "remove_label") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Parar de acionar você neste celular? Se o app do Brigade ainda estiver conectado nele, ele se registra de novo assim que o app estiver aberto: saia da conta no app para parar de vez.`);
		if (i?.part === "remove_go") return /** @type {LocalizedString} */ (`Remover celular`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removendo…`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Não foi possível remover este celular. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Seus celulares`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Your phones`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`The phones where the Brigade app pages you in this workspace, up to ${i?.max}. A new phone past that replaces the one heard from least recently. Everyone in the workspace sees these, so they can tell why someone was or wasn't paged.`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading your phones…`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load your phones.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No phone pages you here yet. Sign in on the Brigade app on your phone to get pages.`);
		if (i?.part === "platform_ios") return /** @type {LocalizedString} */ (`iPhone`);
		if (i?.part === "platform_android") return /** @type {LocalizedString} */ (`Android phone`);
		if (i?.part === "env_production") return /** @type {LocalizedString} */ (`App Store or TestFlight build`);
		if (i?.part === "env_sandbox") return /** @type {LocalizedString} */ (`Development build`);
		if (i?.part === "id") return /** @type {LocalizedString} */ (`ID ending ${i?.suffix}`);
		if (i?.part === "registered") return /** @type {LocalizedString} */ (`Registered ${i?.when}`);
		if (i?.part === "seen") return /** @type {LocalizedString} */ (`Last heard from ${i?.when}`);
		if (i?.part === "seen_hint") return /** @type {LocalizedString} */ (`The last time the app registered this phone, even with nothing new to send, or the phone confirmed it showed a page`);
		if (i?.part === "calls_on") return /** @type {LocalizedString} */ (`Rings as a call`);
		if (i?.part === "calls_off") return /** @type {LocalizedString} */ (`Notifications only`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.part === "remove_label") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Stop paging this ${i?.name}? If the Brigade app is still signed in on it, it registers again as soon as the app is open: sign out in the app to stop it for good.`);
		if (i?.part === "remove_go") return /** @type {LocalizedString} */ (`Remove phone`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removing…`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Couldn't remove this phone. Try again.`);
		return /** @type {LocalizedString} */ (`Your phones`)
	}
});