/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ type: NonNullable<unknown> }} Webhook_EventInputs */



/**
* | type | output |
* | --- | --- |
* | "incident.declared" | "Incident declared" |
* | "incident.status_changed" | "Status changed" |
* | "incident.severity_changed" | "Severity changed" |
* | "incident.acknowledged" | "Acknowledged" |
* | "incident.update_posted" | "Update posted" |
* | "incident.renamed" | "Incident renamed" |
* | "incident.update_edited" | "Update edited" |
* | "incident.update_deleted" | "Update removed" |
* | "incident.role_assigned" | "Role assigned" |
* | "alert.fired" | "Alert fired" |
* | "alert.resolved" | "Alert resolved" |
* | "monitor.status_changed" | "Monitor status changed" |
* | "escalation.paged" | "Escalation level paged" |
* | "webhook.test" | "Test event" |
* | * | "Incident declared" |
*
* @param {Webhook_EventInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const webhook_event = /** @type {((inputs: Webhook_EventInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_EventInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.type === "incident.declared") return /** @type {LocalizedString} */ (`Incidente declarado`);
		if (i?.type === "incident.status_changed") return /** @type {LocalizedString} */ (`Status alterado`);
		if (i?.type === "incident.severity_changed") return /** @type {LocalizedString} */ (`Severidade alterada`);
		if (i?.type === "incident.acknowledged") return /** @type {LocalizedString} */ (`Reconhecido`);
		if (i?.type === "incident.update_posted") return /** @type {LocalizedString} */ (`Atualização publicada`);
		if (i?.type === "incident.renamed") return /** @type {LocalizedString} */ (`Incidente renomeado`);
		if (i?.type === "incident.update_edited") return /** @type {LocalizedString} */ (`Atualização editada`);
		if (i?.type === "incident.update_deleted") return /** @type {LocalizedString} */ (`Atualização removida`);
		if (i?.type === "incident.role_assigned") return /** @type {LocalizedString} */ (`Papel atribuído`);
		if (i?.type === "alert.fired") return /** @type {LocalizedString} */ (`Alerta disparado`);
		if (i?.type === "alert.resolved") return /** @type {LocalizedString} */ (`Alerta resolvido`);
		if (i?.type === "monitor.status_changed") return /** @type {LocalizedString} */ (`Status do monitor alterado`);
		if (i?.type === "escalation.paged") return /** @type {LocalizedString} */ (`Nível de escalonamento acionado`);
		if (i?.type === "webhook.test") return /** @type {LocalizedString} */ (`Evento de teste`);
		return /** @type {LocalizedString} */ (`Incidente declarado`)
	}
	{
		if (i?.type === "incident.declared") return /** @type {LocalizedString} */ (`Incident declared`);
		if (i?.type === "incident.status_changed") return /** @type {LocalizedString} */ (`Status changed`);
		if (i?.type === "incident.severity_changed") return /** @type {LocalizedString} */ (`Severity changed`);
		if (i?.type === "incident.acknowledged") return /** @type {LocalizedString} */ (`Acknowledged`);
		if (i?.type === "incident.update_posted") return /** @type {LocalizedString} */ (`Update posted`);
		if (i?.type === "incident.renamed") return /** @type {LocalizedString} */ (`Incident renamed`);
		if (i?.type === "incident.update_edited") return /** @type {LocalizedString} */ (`Update edited`);
		if (i?.type === "incident.update_deleted") return /** @type {LocalizedString} */ (`Update removed`);
		if (i?.type === "incident.role_assigned") return /** @type {LocalizedString} */ (`Role assigned`);
		if (i?.type === "alert.fired") return /** @type {LocalizedString} */ (`Alert fired`);
		if (i?.type === "alert.resolved") return /** @type {LocalizedString} */ (`Alert resolved`);
		if (i?.type === "monitor.status_changed") return /** @type {LocalizedString} */ (`Monitor status changed`);
		if (i?.type === "escalation.paged") return /** @type {LocalizedString} */ (`Escalation level paged`);
		if (i?.type === "webhook.test") return /** @type {LocalizedString} */ (`Test event`);
		return /** @type {LocalizedString} */ (`Incident declared`)
	}
});