/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown> }} Maintenance_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Scheduled maintenance" |
* | "description" | "Tell customers about planned work. It shows on the status page, and subscribers get an email when it's planned, when it starts and when it ends." |
* | "empty" | "No maintenance planned." |
* | "schedule" | "Schedule maintenance" |
* | "title_label" | "Public title" |
* | "body_label" | "What the public should know" |
* | "components_label" | "Affected components" |
* | "starts_label" | "Starts" |
* | "ends_label" | "Ends" |
* | "times_hint" | "In your time zone ({name}). Visitors see the public page in their own." |
* | "save" | "Schedule" |
* | "saving" | "Saving…" |
* | "update" | "Save" |
* | "failed" | "Couldn't save. Try again." |
* | "title_required" | "The public needs a title." |
* | "body_required" | "Write what the public should know." |
* | "times_required" | "Pick when it starts and ends." |
* | "ends_before" | "The window must end after it starts." |
* | "too_long" | "A window lasts at most 14 days." |
* | "ended" | "That window has already ended." |
* | "limit" | "At most 20 windows can be planned at once." |
* | "phase_scheduled" | "Scheduled" |
* | "phase_in_progress" | "In progress" |
* | "phase_completed" | "Completed" |
* | "window" | "{time} to {until}" |
* | "edit" | "Edit" |
* | "cancel" | "Cancel" |
* | "end_now" | "End now" |
* | "call_off" | "Call off" |
* | "call_off_confirm" | "Call off {name}? It leaves the status page and subscribers get an email saying so." |
* | "keep" | "Keep" |
* | "not_set_up" | "Set up the status page first to plan maintenance on it." |
* | "viewer" | "Owners, admins and responders can schedule maintenance." |
* | "past_title" | "Completed" |
* | "outage_label" | "Planned outage" |
* | "outage_hint" | "The affected components show as down on the status page while it runs, not only under maintenance." |
* | "outage_badge" | "Planned outage" |
* | * | "Maintenance" |
*
* @param {Maintenance_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const maintenance_card = /** @type {((inputs: Maintenance_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Maintenance_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Manutenção programada`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Avise os clientes sobre trabalhos planejados. Aparece na página de status, e os inscritos recebem um email quando é programada, quando começa e quando termina.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhuma manutenção programada.`);
		if (i?.part === "schedule") return /** @type {LocalizedString} */ (`Programar manutenção`);
		if (i?.part === "title_label") return /** @type {LocalizedString} */ (`Título público`);
		if (i?.part === "body_label") return /** @type {LocalizedString} */ (`O que o público deve saber`);
		if (i?.part === "components_label") return /** @type {LocalizedString} */ (`Componentes afetados`);
		if (i?.part === "starts_label") return /** @type {LocalizedString} */ (`Início`);
		if (i?.part === "ends_label") return /** @type {LocalizedString} */ (`Fim`);
		if (i?.part === "times_hint") return /** @type {LocalizedString} */ (`No seu fuso horário (${i?.name}). Cada visitante vê a página pública no próprio fuso.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Programar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "update") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível salvar. Tente de novo.`);
		if (i?.part === "title_required") return /** @type {LocalizedString} */ (`O público precisa de um título.`);
		if (i?.part === "body_required") return /** @type {LocalizedString} */ (`Escreva o que o público deve saber.`);
		if (i?.part === "times_required") return /** @type {LocalizedString} */ (`Escolha quando começa e quando termina.`);
		if (i?.part === "ends_before") return /** @type {LocalizedString} */ (`A janela precisa terminar depois de começar.`);
		if (i?.part === "too_long") return /** @type {LocalizedString} */ (`Uma janela dura no máximo 14 dias.`);
		if (i?.part === "ended") return /** @type {LocalizedString} */ (`Essa janela já terminou.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`No máximo 20 janelas podem estar programadas ao mesmo tempo.`);
		if (i?.part === "phase_scheduled") return /** @type {LocalizedString} */ (`Programada`);
		if (i?.part === "phase_in_progress") return /** @type {LocalizedString} */ (`Em andamento`);
		if (i?.part === "phase_completed") return /** @type {LocalizedString} */ (`Concluída`);
		if (i?.part === "window") return /** @type {LocalizedString} */ (`De ${i?.time} a ${i?.until}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "end_now") return /** @type {LocalizedString} */ (`Encerrar agora`);
		if (i?.part === "call_off") return /** @type {LocalizedString} */ (`Cancelar manutenção`);
		if (i?.part === "call_off_confirm") return /** @type {LocalizedString} */ (`Cancelar ${i?.name}? Ela sai da página de status e os inscritos recebem um email avisando.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`Configure a página de status primeiro para programar manutenções nela.`);
		if (i?.part === "viewer") return /** @type {LocalizedString} */ (`Owners, admins e responders podem programar manutenções.`);
		if (i?.part === "past_title") return /** @type {LocalizedString} */ (`Concluídas`);
		if (i?.part === "outage_label") return /** @type {LocalizedString} */ (`Indisponibilidade planejada`);
		if (i?.part === "outage_hint") return /** @type {LocalizedString} */ (`Os componentes afetados aparecem fora do ar na página de status enquanto ela dura, não só em manutenção.`);
		if (i?.part === "outage_badge") return /** @type {LocalizedString} */ (`Indisponibilidade planejada`);
		return /** @type {LocalizedString} */ (`Manutenção`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Scheduled maintenance`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Tell customers about planned work. It shows on the status page, and subscribers get an email when it's planned, when it starts and when it ends.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No maintenance planned.`);
		if (i?.part === "schedule") return /** @type {LocalizedString} */ (`Schedule maintenance`);
		if (i?.part === "title_label") return /** @type {LocalizedString} */ (`Public title`);
		if (i?.part === "body_label") return /** @type {LocalizedString} */ (`What the public should know`);
		if (i?.part === "components_label") return /** @type {LocalizedString} */ (`Affected components`);
		if (i?.part === "starts_label") return /** @type {LocalizedString} */ (`Starts`);
		if (i?.part === "ends_label") return /** @type {LocalizedString} */ (`Ends`);
		if (i?.part === "times_hint") return /** @type {LocalizedString} */ (`In your time zone (${i?.name}). Visitors see the public page in their own.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Schedule`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "update") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't save. Try again.`);
		if (i?.part === "title_required") return /** @type {LocalizedString} */ (`The public needs a title.`);
		if (i?.part === "body_required") return /** @type {LocalizedString} */ (`Write what the public should know.`);
		if (i?.part === "times_required") return /** @type {LocalizedString} */ (`Pick when it starts and ends.`);
		if (i?.part === "ends_before") return /** @type {LocalizedString} */ (`The window must end after it starts.`);
		if (i?.part === "too_long") return /** @type {LocalizedString} */ (`A window lasts at most 14 days.`);
		if (i?.part === "ended") return /** @type {LocalizedString} */ (`That window has already ended.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`At most 20 windows can be planned at once.`);
		if (i?.part === "phase_scheduled") return /** @type {LocalizedString} */ (`Scheduled`);
		if (i?.part === "phase_in_progress") return /** @type {LocalizedString} */ (`In progress`);
		if (i?.part === "phase_completed") return /** @type {LocalizedString} */ (`Completed`);
		if (i?.part === "window") return /** @type {LocalizedString} */ (`${i?.time} to ${i?.until}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "end_now") return /** @type {LocalizedString} */ (`End now`);
		if (i?.part === "call_off") return /** @type {LocalizedString} */ (`Call off`);
		if (i?.part === "call_off_confirm") return /** @type {LocalizedString} */ (`Call off ${i?.name}? It leaves the status page and subscribers get an email saying so.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`Set up the status page first to plan maintenance on it.`);
		if (i?.part === "viewer") return /** @type {LocalizedString} */ (`Owners, admins and responders can schedule maintenance.`);
		if (i?.part === "past_title") return /** @type {LocalizedString} */ (`Completed`);
		if (i?.part === "outage_label") return /** @type {LocalizedString} */ (`Planned outage`);
		if (i?.part === "outage_hint") return /** @type {LocalizedString} */ (`The affected components show as down on the status page while it runs, not only under maintenance.`);
		if (i?.part === "outage_badge") return /** @type {LocalizedString} */ (`Planned outage`);
		return /** @type {LocalizedString} */ (`Maintenance`)
	}
});