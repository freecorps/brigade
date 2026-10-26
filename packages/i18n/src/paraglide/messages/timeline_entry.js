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
* | "page_failed_no_devices" | "Couldn't page {a}: no registered device" |
* | "page_failed_over_limit" | "Couldn't page {a}: this page went to too many phones" |
* | "page_nobody" | "Nobody was paged: no one who can respond has Brigade on their phone" |
* | "page_dead_lettered" | "A page may not have gone out: Brigade kept failing to send it" |
* | "page_failed_not_a_member" | "Couldn't page {a}: no longer someone who can respond" |
* | "page_nobody_on_call" | "Couldn't page {a}: nobody on call" |
* | "page_schedule_missing" | "Couldn't page a schedule that was deleted" |
* | "escalated_started" | "Paged level {a}: {b}" |
* | "escalated_timeout" | "Nobody acknowledged, so level {a} was paged: {b}" |
* | "escalated_unreachable" | "Earlier levels couldn't reach anyone, so level {a} was paged: {b}" |
* | "escalated_everyone" | "No level could reach anyone, so everyone who can respond was paged" |
* | "escalated_everyone_later" | "No later level could reach anyone, so everyone who can respond was paged" |
* | "escalated_started_aware" | "Level {a}: {b}" |
* | "escalated_again" | "Level {a} paged again: the earlier page was lost" |
* | "escalated_everyone_again" | "Everyone who can respond paged again: the earlier page was lost" |
* | "page_nobody_else" | "Nobody else was paged: only the person who declared it can respond" |
* | "escalation_exhausted" | "Nobody acknowledged after every level, so everyone who can respond was paged" |
* | "escalated_everyone_stalled" | "An escalation level kept failing to fire, so everyone who can respond was paged" |
* | "page_escalation_stalled" | "An escalation level couldn't fire. Brigade keeps trying, and pages everyone who can respond if it still can't" |
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
		if (i?.kind === "page_failed_no_devices") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: nenhum aparelho registrado`);
		if (i?.kind === "page_failed_over_limit") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: a chamada foi para celulares demais`);
		if (i?.kind === "page_nobody") return /** @type {LocalizedString} */ (`Ninguém foi chamado: ninguém que pode responder tem o Brigade no celular`);
		if (i?.kind === "page_dead_lettered") return /** @type {LocalizedString} */ (`Uma chamada pode não ter saído: o Brigade não conseguiu enviá-la`);
		if (i?.kind === "page_failed_not_a_member") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: não é mais alguém que pode responder`);
		if (i?.kind === "page_nobody_on_call") return /** @type {LocalizedString} */ (`Não foi possível chamar ${i?.a}: ninguém de plantão`);
		if (i?.kind === "page_schedule_missing") return /** @type {LocalizedString} */ (`Não foi possível chamar uma escala que foi excluída`);
		if (i?.kind === "escalated_started") return /** @type {LocalizedString} */ (`Nível ${i?.a} chamado: ${i?.b}`);
		if (i?.kind === "escalated_timeout") return /** @type {LocalizedString} */ (`Ninguém confirmou, então o nível ${i?.a} foi chamado: ${i?.b}`);
		if (i?.kind === "escalated_unreachable") return /** @type {LocalizedString} */ (`Os níveis anteriores não alcançaram ninguém, então o nível ${i?.a} foi chamado: ${i?.b}`);
		if (i?.kind === "escalated_everyone") return /** @type {LocalizedString} */ (`Nenhum nível alcançou ninguém, então todos que podem responder foram chamados`);
		if (i?.kind === "escalated_everyone_later") return /** @type {LocalizedString} */ (`Nenhum nível seguinte alcançou ninguém, então todos que podem responder foram chamados`);
		if (i?.kind === "escalated_started_aware") return /** @type {LocalizedString} */ (`Nível ${i?.a}: ${i?.b}`);
		if (i?.kind === "escalated_again") return /** @type {LocalizedString} */ (`Nível ${i?.a} chamado de novo: a chamada anterior se perdeu`);
		if (i?.kind === "escalated_everyone_again") return /** @type {LocalizedString} */ (`Todos que podem responder chamados de novo: a chamada anterior se perdeu`);
		if (i?.kind === "page_nobody_else") return /** @type {LocalizedString} */ (`Ninguém mais foi chamado: só quem declarou pode responder`);
		if (i?.kind === "escalation_exhausted") return /** @type {LocalizedString} */ (`Ninguém confirmou depois de todos os níveis, então todos que podem responder foram chamados`);
		if (i?.kind === "escalated_everyone_stalled") return /** @type {LocalizedString} */ (`Um nível de escalonamento continuou falhando, então todos que podem responder foram chamados`);
		if (i?.kind === "page_escalation_stalled") return /** @type {LocalizedString} */ (`Um nível de escalonamento não pôde ser disparado. O Brigade continua tentando e chama todos que podem responder se ainda falhar`);
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
		if (i?.kind === "page_failed_no_devices") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: no registered device`);
		if (i?.kind === "page_failed_over_limit") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: this page went to too many phones`);
		if (i?.kind === "page_nobody") return /** @type {LocalizedString} */ (`Nobody was paged: no one who can respond has Brigade on their phone`);
		if (i?.kind === "page_dead_lettered") return /** @type {LocalizedString} */ (`A page may not have gone out: Brigade kept failing to send it`);
		if (i?.kind === "page_failed_not_a_member") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: no longer someone who can respond`);
		if (i?.kind === "page_nobody_on_call") return /** @type {LocalizedString} */ (`Couldn't page ${i?.a}: nobody on call`);
		if (i?.kind === "page_schedule_missing") return /** @type {LocalizedString} */ (`Couldn't page a schedule that was deleted`);
		if (i?.kind === "escalated_started") return /** @type {LocalizedString} */ (`Paged level ${i?.a}: ${i?.b}`);
		if (i?.kind === "escalated_timeout") return /** @type {LocalizedString} */ (`Nobody acknowledged, so level ${i?.a} was paged: ${i?.b}`);
		if (i?.kind === "escalated_unreachable") return /** @type {LocalizedString} */ (`Earlier levels couldn't reach anyone, so level ${i?.a} was paged: ${i?.b}`);
		if (i?.kind === "escalated_everyone") return /** @type {LocalizedString} */ (`No level could reach anyone, so everyone who can respond was paged`);
		if (i?.kind === "escalated_everyone_later") return /** @type {LocalizedString} */ (`No later level could reach anyone, so everyone who can respond was paged`);
		if (i?.kind === "escalated_started_aware") return /** @type {LocalizedString} */ (`Level ${i?.a}: ${i?.b}`);
		if (i?.kind === "escalated_again") return /** @type {LocalizedString} */ (`Level ${i?.a} paged again: the earlier page was lost`);
		if (i?.kind === "escalated_everyone_again") return /** @type {LocalizedString} */ (`Everyone who can respond paged again: the earlier page was lost`);
		if (i?.kind === "page_nobody_else") return /** @type {LocalizedString} */ (`Nobody else was paged: only the person who declared it can respond`);
		if (i?.kind === "escalation_exhausted") return /** @type {LocalizedString} */ (`Nobody acknowledged after every level, so everyone who can respond was paged`);
		if (i?.kind === "escalated_everyone_stalled") return /** @type {LocalizedString} */ (`An escalation level kept failing to fire, so everyone who can respond was paged`);
		if (i?.kind === "page_escalation_stalled") return /** @type {LocalizedString} */ (`An escalation level couldn't fire. Brigade keeps trying, and pages everyone who can respond if it still can't`);
		return /** @type {LocalizedString} */ (`${i?.actor} changed the incident`)
	}
});