/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} NavInputs */



/**
* | part | output |
* | --- | --- |
* | "label" | "Dashboard" |
* | "respond" | "Respond" |
* | "configure" | "Configure" |
* | "overview" | "Overview" |
* | "incidents" | "Incidents" |
* | "follow_ups" | "Follow-ups" |
* | "on_call" | "On call" |
* | "monitors" | "Monitors" |
* | "services" | "Services" |
* | "escalation" | "Escalation" |
* | "alerts" | "Alerts" |
* | "integrations" | "Integrations" |
* | "status_page" | "Status page" |
* | "members" | "Members" |
* | "settings" | "Workspace settings" |
* | "account" | "Your account" |
* | "open" | "Open menu" |
* | "close" | "Close menu" |
* | "menu" | "Menu" |
* | * | "Brigade" |
*
* @param {NavInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const nav = /** @type {((inputs: NavInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<NavInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Painel`);
		if (i?.part === "respond") return /** @type {LocalizedString} */ (`Resposta`);
		if (i?.part === "configure") return /** @type {LocalizedString} */ (`Configuração`);
		if (i?.part === "overview") return /** @type {LocalizedString} */ (`Visão geral`);
		if (i?.part === "incidents") return /** @type {LocalizedString} */ (`Incidentes`);
		if (i?.part === "follow_ups") return /** @type {LocalizedString} */ (`Follow-ups`);
		if (i?.part === "on_call") return /** @type {LocalizedString} */ (`Plantão`);
		if (i?.part === "monitors") return /** @type {LocalizedString} */ (`Monitores`);
		if (i?.part === "services") return /** @type {LocalizedString} */ (`Serviços`);
		if (i?.part === "escalation") return /** @type {LocalizedString} */ (`Escalonamento`);
		if (i?.part === "alerts") return /** @type {LocalizedString} */ (`Alertas`);
		if (i?.part === "integrations") return /** @type {LocalizedString} */ (`Integrações`);
		if (i?.part === "status_page") return /** @type {LocalizedString} */ (`Página de status`);
		if (i?.part === "members") return /** @type {LocalizedString} */ (`Membros`);
		if (i?.part === "settings") return /** @type {LocalizedString} */ (`Configurações do workspace`);
		if (i?.part === "account") return /** @type {LocalizedString} */ (`Sua conta`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir menu`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar menu`);
		if (i?.part === "menu") return /** @type {LocalizedString} */ (`Menu`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Dashboard`);
		if (i?.part === "respond") return /** @type {LocalizedString} */ (`Respond`);
		if (i?.part === "configure") return /** @type {LocalizedString} */ (`Configure`);
		if (i?.part === "overview") return /** @type {LocalizedString} */ (`Overview`);
		if (i?.part === "incidents") return /** @type {LocalizedString} */ (`Incidents`);
		if (i?.part === "follow_ups") return /** @type {LocalizedString} */ (`Follow-ups`);
		if (i?.part === "on_call") return /** @type {LocalizedString} */ (`On call`);
		if (i?.part === "monitors") return /** @type {LocalizedString} */ (`Monitors`);
		if (i?.part === "services") return /** @type {LocalizedString} */ (`Services`);
		if (i?.part === "escalation") return /** @type {LocalizedString} */ (`Escalation`);
		if (i?.part === "alerts") return /** @type {LocalizedString} */ (`Alerts`);
		if (i?.part === "integrations") return /** @type {LocalizedString} */ (`Integrations`);
		if (i?.part === "status_page") return /** @type {LocalizedString} */ (`Status page`);
		if (i?.part === "members") return /** @type {LocalizedString} */ (`Members`);
		if (i?.part === "settings") return /** @type {LocalizedString} */ (`Workspace settings`);
		if (i?.part === "account") return /** @type {LocalizedString} */ (`Your account`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open menu`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close menu`);
		if (i?.part === "menu") return /** @type {LocalizedString} */ (`Menu`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});