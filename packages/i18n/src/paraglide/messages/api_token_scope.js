/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ scope: NonNullable<unknown> }} Api_Token_ScopeInputs */



/**
* | scope | output |
* | --- | --- |
* | "incident_read" | "Read incidents" |
* | "incident_declare" | "Declare incidents" |
* | "incident_update" | "Update incidents" |
* | "incident_ack" | "Acknowledge incidents" |
* | "workspace_read" | "Read the workspace and its members" |
* | "workspace_manage" | "Change workspace settings" |
* | "members_manage" | "Manage members and invitations" |
* | "monitor_read" | "Read monitors" |
* | "monitor_manage" | "Manage monitors" |
* | "schedule_read" | "Read on-call schedules" |
* | "schedule_manage" | "Manage on-call schedules" |
* | "schedule_override" | "Add on-call overrides" |
* | "escalation_read" | "Read escalation policies" |
* | "escalation_manage" | "Manage escalation policies" |
* | "status_read" | "Read the status page" |
* | "status_manage" | "Manage the status page" |
* | "status_publish" | "Publish status updates" |
* | "webhook_manage" | "Manage webhooks" |
* | "catalog_read" | "Read the catalog" |
* | "catalog_manage" | "Manage the catalog" |
* | "data_export" | "Export incidents" |
* | "alert_read" | "Read alerts" |
* | "alert_manage" | "Manage alert sources" |
* | * | "Another permission" |
*
* @param {Api_Token_ScopeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const api_token_scope = /** @type {((inputs: Api_Token_ScopeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Token_ScopeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.scope === "incident_read") return /** @type {LocalizedString} */ (`Ler incidentes`);
		if (i?.scope === "incident_declare") return /** @type {LocalizedString} */ (`Declarar incidentes`);
		if (i?.scope === "incident_update") return /** @type {LocalizedString} */ (`Atualizar incidentes`);
		if (i?.scope === "incident_ack") return /** @type {LocalizedString} */ (`Reconhecer incidentes`);
		if (i?.scope === "workspace_read") return /** @type {LocalizedString} */ (`Ler o workspace e os membros`);
		if (i?.scope === "workspace_manage") return /** @type {LocalizedString} */ (`Mudar as configurações do workspace`);
		if (i?.scope === "members_manage") return /** @type {LocalizedString} */ (`Gerenciar membros e convites`);
		if (i?.scope === "monitor_read") return /** @type {LocalizedString} */ (`Ler monitores`);
		if (i?.scope === "monitor_manage") return /** @type {LocalizedString} */ (`Gerenciar monitores`);
		if (i?.scope === "schedule_read") return /** @type {LocalizedString} */ (`Ler escalas de plantão`);
		if (i?.scope === "schedule_manage") return /** @type {LocalizedString} */ (`Gerenciar escalas de plantão`);
		if (i?.scope === "schedule_override") return /** @type {LocalizedString} */ (`Adicionar trocas de plantão`);
		if (i?.scope === "escalation_read") return /** @type {LocalizedString} */ (`Ler políticas de escalonamento`);
		if (i?.scope === "escalation_manage") return /** @type {LocalizedString} */ (`Gerenciar políticas de escalonamento`);
		if (i?.scope === "status_read") return /** @type {LocalizedString} */ (`Ler a página de status`);
		if (i?.scope === "status_manage") return /** @type {LocalizedString} */ (`Gerenciar a página de status`);
		if (i?.scope === "status_publish") return /** @type {LocalizedString} */ (`Publicar atualizações de status`);
		if (i?.scope === "webhook_manage") return /** @type {LocalizedString} */ (`Gerenciar webhooks`);
		if (i?.scope === "catalog_read") return /** @type {LocalizedString} */ (`Ler o catálogo`);
		if (i?.scope === "catalog_manage") return /** @type {LocalizedString} */ (`Gerenciar o catálogo`);
		if (i?.scope === "data_export") return /** @type {LocalizedString} */ (`Exportar incidentes`);
		if (i?.scope === "alert_read") return /** @type {LocalizedString} */ (`Ler alertas`);
		if (i?.scope === "alert_manage") return /** @type {LocalizedString} */ (`Gerenciar fontes de alerta`);
		return /** @type {LocalizedString} */ (`Outra permissão`)
	}
	{
		if (i?.scope === "incident_read") return /** @type {LocalizedString} */ (`Read incidents`);
		if (i?.scope === "incident_declare") return /** @type {LocalizedString} */ (`Declare incidents`);
		if (i?.scope === "incident_update") return /** @type {LocalizedString} */ (`Update incidents`);
		if (i?.scope === "incident_ack") return /** @type {LocalizedString} */ (`Acknowledge incidents`);
		if (i?.scope === "workspace_read") return /** @type {LocalizedString} */ (`Read the workspace and its members`);
		if (i?.scope === "workspace_manage") return /** @type {LocalizedString} */ (`Change workspace settings`);
		if (i?.scope === "members_manage") return /** @type {LocalizedString} */ (`Manage members and invitations`);
		if (i?.scope === "monitor_read") return /** @type {LocalizedString} */ (`Read monitors`);
		if (i?.scope === "monitor_manage") return /** @type {LocalizedString} */ (`Manage monitors`);
		if (i?.scope === "schedule_read") return /** @type {LocalizedString} */ (`Read on-call schedules`);
		if (i?.scope === "schedule_manage") return /** @type {LocalizedString} */ (`Manage on-call schedules`);
		if (i?.scope === "schedule_override") return /** @type {LocalizedString} */ (`Add on-call overrides`);
		if (i?.scope === "escalation_read") return /** @type {LocalizedString} */ (`Read escalation policies`);
		if (i?.scope === "escalation_manage") return /** @type {LocalizedString} */ (`Manage escalation policies`);
		if (i?.scope === "status_read") return /** @type {LocalizedString} */ (`Read the status page`);
		if (i?.scope === "status_manage") return /** @type {LocalizedString} */ (`Manage the status page`);
		if (i?.scope === "status_publish") return /** @type {LocalizedString} */ (`Publish status updates`);
		if (i?.scope === "webhook_manage") return /** @type {LocalizedString} */ (`Manage webhooks`);
		if (i?.scope === "catalog_read") return /** @type {LocalizedString} */ (`Read the catalog`);
		if (i?.scope === "catalog_manage") return /** @type {LocalizedString} */ (`Manage the catalog`);
		if (i?.scope === "data_export") return /** @type {LocalizedString} */ (`Export incidents`);
		if (i?.scope === "alert_read") return /** @type {LocalizedString} */ (`Read alerts`);
		if (i?.scope === "alert_manage") return /** @type {LocalizedString} */ (`Manage alert sources`);
		return /** @type {LocalizedString} */ (`Another permission`)
	}
});