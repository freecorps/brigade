/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, actor: NonNullable<unknown>, a: NonNullable<unknown>, b: NonNullable<unknown> }} Timeline_EntryInputs */



/**
* | kind | output |
* | --- | --- |
* | "declared" | "{actor} declared the incident as {a}" |
* | "status_changed" | "{actor} changed the status from {a} to {b}" |
* | "severity_changed" | "{actor} changed the severity from {a} to {b}" |
* | "acknowledged" | "{actor} acknowledged the page" |
* | "role_assigned" | "{actor} made {b} {a}" |
* | "role_unassigned" | "{actor} removed {b} as {a}" |
* | "role_taken" | "{actor} took the {a} role" |
* | "role_left" | "{actor} stepped down as {a}" |
* | "update" | "{actor} posted an update" |
* | "alert_recovered" | "{a} recovered, so its alert resolved" |
* | "alert_paused" | "{actor} paused {a}, so its alert resolved" |
* | "alert_deleted" | "{actor} deleted {a}, so its alert resolved" |
* | "page_failed_undelivered" | "Couldn't page {a}: the push didn't go through" |
* | "page_failed_unsupported" | "Couldn't page {a}: Brigade can't push to Android phones yet" |
* | "page_failed_not_configured" | "Couldn't page {a}: push notifications aren't set up on this server" |
* | "page_nobody" | "Nobody was paged: no one who can respond has Brigade on their phone" |
* | * | "{actor} changed the incident" |
*
* @param {Timeline_EntryInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const timeline_entry = /** @type {((inputs: Timeline_EntryInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Timeline_EntryInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "declared") return /** @type {LocalizedString} */ (`${i?.actor} declarou o incidente como ${i?.a}`);
		if (i?.kind === "status_changed") return /** @type {LocalizedString} */ (`${i?.actor} mudou o status de ${i?.a} para ${i?.b}`);
		if (i?.kind === "severity_changed") return /** @type {LocalizedString} */ (`${i?.actor} mudou a severidade de ${i?.a} para ${i?.b}`);
		if (i?.kind === "acknowledged") return /** @type {LocalizedString} */ (`${i?.actor} reconheceu o chamado`);
		if (i?.kind === "role_assigned") return /** @type {LocalizedString} */ (`${i?.actor} definiu ${i?.b} como ${i?.a}`);
		if (i?.kind === "role_unassigned") return /** @type {LocalizedString} */ (`${i?.actor} tirou ${i?.b} de ${i?.a}`);
		if (i?.kind === "role_taken") return /** @type {LocalizedString} */ (`${i?.actor} assumiu o papel de ${i?.a}`);
		if (i?.kind === "role_left") return /** @type {LocalizedString} */ (`${i?.actor} deixou o papel de ${i?.a}`);
		if (i?.kind === "update") return /** @type {LocalizedString} */ (`${i?.actor} publicou uma atualização`);
		if (i?.kind === "alert_recovered") return /** @type {LocalizedString} */ (`${i?.a} se recuperou, e o alerta foi resolvido`);
		if (i?.kind === "alert_paused") return /** @type {LocalizedString} */ (`${i?.actor} pausou ${i?.a}, e o alerta foi resolvido`);
		if (i?.kind === "alert_deleted") return /** @type {LocalizedString} */ (`${i?.actor} excluiu ${i?.a}, e o alerta foi resolvido`);
		if (i?.kind === "page_failed_undelivered") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: o push não foi entregue`);
		if (i?.kind === "page_failed_unsupported") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: o Brigade ainda não envia pushes para Android`);
		if (i?.kind === "page_failed_not_configured") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: as notificações push não estão configuradas neste servidor`);
		if (i?.kind === "page_nobody") return /** @type {LocalizedString} */ (`Ninguém foi chamado: ninguém que pode responder tem o Brigade no celular`);
		return /** @type {LocalizedString} */ (`${i?.actor} alterou o incidente`)
	}
	{
		if (i?.kind === "declared") return /** @type {LocalizedString} */ (`${i?.actor} declared the incident as ${i?.a}`);
		if (i?.kind === "status_changed") return /** @type {LocalizedString} */ (`${i?.actor} changed the status from ${i?.a} to ${i?.b}`);
		if (i?.kind === "severity_changed") return /** @type {LocalizedString} */ (`${i?.actor} changed the severity from ${i?.a} to ${i?.b}`);
		if (i?.kind === "acknowledged") return /** @type {LocalizedString} */ (`${i?.actor} acknowledged the page`);
		if (i?.kind === "role_assigned") return /** @type {LocalizedString} */ (`${i?.actor} made ${i?.b} ${i?.a}`);
		if (i?.kind === "role_unassigned") return /** @type {LocalizedString} */ (`${i?.actor} removed ${i?.b} as ${i?.a}`);
		if (i?.kind === "role_taken") return /** @type {LocalizedString} */ (`${i?.actor} took the ${i?.a} role`);
		if (i?.kind === "role_left") return /** @type {LocalizedString} */ (`${i?.actor} stepped down as ${i?.a}`);
		if (i?.kind === "update") return /** @type {LocalizedString} */ (`${i?.actor} posted an update`);
		if (i?.kind === "alert_recovered") return /** @type {LocalizedString} */ (`${i?.a} recovered, so its alert resolved`);
		if (i?.kind === "alert_paused") return /** @type {LocalizedString} */ (`${i?.actor} paused ${i?.a}, so its alert resolved`);
		if (i?.kind === "alert_deleted") return /** @type {LocalizedString} */ (`${i?.actor} deleted ${i?.a}, so its alert resolved`);
		if (i?.kind === "page_failed_undelivered") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: the push didn't go through`);
		if (i?.kind === "page_failed_unsupported") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: Brigade can't push to Android phones yet`);
		if (i?.kind === "page_failed_not_configured") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: push notifications aren't set up on this server`);
		if (i?.kind === "page_nobody") return /** @type {LocalizedString} */ (`Nobody was paged: no one who can respond has Brigade on their phone`);
		return /** @type {LocalizedString} */ (`${i?.actor} changed the incident`)
	}
});