/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, date: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Followup_TextInputs */



/**
* | text | output |
* | --- | --- |
* | "title" | "Follow-ups" |
* | "description" | "What this incident leaves to do, with an owner and a due date." |
* | "empty" | "No follow-ups yet." |
* | "add" | "Add follow-up" |
* | "title_label" | "What needs doing" |
* | "title_placeholder" | "Add a retry budget to the payment client" |
* | "owner_label" | "Owner" |
* | "no_owner" | "No owner" |
* | "due_label" | "Due" |
* | "no_due" | "No due date" |
* | "link_label" | "Issue link" |
* | "link_placeholder" | "https://" |
* | "link_invalid" | "Enter a link that starts with http:// or https://." |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "edit" | "Edit {name}" |
* | "delete" | "Remove {name}" |
* | "delete_confirm" | "Remove {name}? It stays on the timeline." |
* | "mark_done" | "Mark {name} as done" |
* | "mark_open" | "Reopen {name}" |
* | "due_on" | "Due {date}" |
* | "overdue" | "Overdue since {date}" |
* | "done_on" | "Done {date}" |
* | "open_link" | "Open issue" |
* | "owner_former" | "Former member" |
* | "done_count" | "Done: {count}" |
* | "limit" | "This incident has as many follow-ups as it can hold. Remove a done one first." |
* | "change_failed" | "Couldn't change {name}: {reason}" |
* | "read_only" | "Only responders, admins and owners change follow-ups." |
* | "open_title" | "Open follow-ups" |
* | "open_description" | "Every open follow-up in the workspace, soonest due first." |
* | "open_empty" | "Nothing open. Follow-ups added to incidents show up here until they're done." |
* | "open_link_all" | "All open follow-ups" |
* | "overdue_count" | "Overdue: {count}" |
* | "loading" | "Loading follow-ups…" |
* | "load_failed" | "Couldn't load follow-ups: {reason}" |
* | "incident_column" | "Incident" |
* | "mine_filter" | "Whose follow-ups" |
* | "all" | "All" |
* | "mine" | "Mine" |
* | "back" | "Overview" |
* | "title_required" | "Say what needs doing." |
* | * | "Follow-ups" |
*
* @param {Followup_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const followup_text = /** @type {((inputs: Followup_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Followup_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Ações de acompanhamento`);
		if (i?.text === "description") return /** @type {LocalizedString} */ (`O que este incidente deixa para fazer, com responsável e prazo.`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`Nenhuma ação de acompanhamento ainda.`);
		if (i?.text === "add") return /** @type {LocalizedString} */ (`Adicionar ação`);
		if (i?.text === "title_label") return /** @type {LocalizedString} */ (`O que precisa ser feito`);
		if (i?.text === "title_placeholder") return /** @type {LocalizedString} */ (`Adicionar limite de novas tentativas ao cliente de pagamentos`);
		if (i?.text === "owner_label") return /** @type {LocalizedString} */ (`Responsável`);
		if (i?.text === "no_owner") return /** @type {LocalizedString} */ (`Sem responsável`);
		if (i?.text === "due_label") return /** @type {LocalizedString} */ (`Prazo`);
		if (i?.text === "no_due") return /** @type {LocalizedString} */ (`Sem prazo`);
		if (i?.text === "link_label") return /** @type {LocalizedString} */ (`Link do chamado`);
		if (i?.text === "link_placeholder") return /** @type {LocalizedString} */ (`https://`);
		if (i?.text === "link_invalid") return /** @type {LocalizedString} */ (`Informe um link que comece com http:// ou https://.`);
		if (i?.text === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.text === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.text === "edit") return /** @type {LocalizedString} */ (`Editar ${i?.name}`);
		if (i?.text === "delete") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		if (i?.text === "delete_confirm") return /** @type {LocalizedString} */ (`Remover ${i?.name}? Ela continua na linha do tempo.`);
		if (i?.text === "mark_done") return /** @type {LocalizedString} */ (`Marcar ${i?.name} como concluída`);
		if (i?.text === "mark_open") return /** @type {LocalizedString} */ (`Reabrir ${i?.name}`);
		if (i?.text === "due_on") return /** @type {LocalizedString} */ (`Prazo ${i?.date}`);
		if (i?.text === "overdue") return /** @type {LocalizedString} */ (`Atrasada desde ${i?.date}`);
		if (i?.text === "done_on") return /** @type {LocalizedString} */ (`Concluída ${i?.date}`);
		if (i?.text === "open_link") return /** @type {LocalizedString} */ (`Abrir chamado`);
		if (i?.text === "owner_former") return /** @type {LocalizedString} */ (`Ex-membro`);
		if (i?.text === "done_count") return /** @type {LocalizedString} */ (`Concluídas: ${i?.count}`);
		if (i?.text === "limit") return /** @type {LocalizedString} */ (`Este incidente já tem o máximo de ações. Remova uma concluída antes.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Não foi possível alterar ${i?.name}: ${i?.reason}`);
		if (i?.text === "read_only") return /** @type {LocalizedString} */ (`Só responders, admins e owners alteram ações de acompanhamento.`);
		if (i?.text === "open_title") return /** @type {LocalizedString} */ (`Ações em aberto`);
		if (i?.text === "open_description") return /** @type {LocalizedString} */ (`Todas as ações em aberto do workspace, pelo prazo mais próximo.`);
		if (i?.text === "open_empty") return /** @type {LocalizedString} */ (`Nada em aberto. As ações adicionadas aos incidentes aparecem aqui até serem concluídas.`);
		if (i?.text === "open_link_all") return /** @type {LocalizedString} */ (`Todas as ações em aberto`);
		if (i?.text === "overdue_count") return /** @type {LocalizedString} */ (`Atrasadas: ${i?.count}`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Carregando ações…`);
		if (i?.text === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar as ações: ${i?.reason}`);
		if (i?.text === "incident_column") return /** @type {LocalizedString} */ (`Incidente`);
		if (i?.text === "mine_filter") return /** @type {LocalizedString} */ (`De quem são as ações`);
		if (i?.text === "all") return /** @type {LocalizedString} */ (`Todas`);
		if (i?.text === "mine") return /** @type {LocalizedString} */ (`Minhas`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Visão geral`);
		if (i?.text === "title_required") return /** @type {LocalizedString} */ (`Diga o que precisa ser feito.`);
		return /** @type {LocalizedString} */ (`Ações de acompanhamento`)
	}
	{
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Follow-ups`);
		if (i?.text === "description") return /** @type {LocalizedString} */ (`What this incident leaves to do, with an owner and a due date.`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`No follow-ups yet.`);
		if (i?.text === "add") return /** @type {LocalizedString} */ (`Add follow-up`);
		if (i?.text === "title_label") return /** @type {LocalizedString} */ (`What needs doing`);
		if (i?.text === "title_placeholder") return /** @type {LocalizedString} */ (`Add a retry budget to the payment client`);
		if (i?.text === "owner_label") return /** @type {LocalizedString} */ (`Owner`);
		if (i?.text === "no_owner") return /** @type {LocalizedString} */ (`No owner`);
		if (i?.text === "due_label") return /** @type {LocalizedString} */ (`Due`);
		if (i?.text === "no_due") return /** @type {LocalizedString} */ (`No due date`);
		if (i?.text === "link_label") return /** @type {LocalizedString} */ (`Issue link`);
		if (i?.text === "link_placeholder") return /** @type {LocalizedString} */ (`https://`);
		if (i?.text === "link_invalid") return /** @type {LocalizedString} */ (`Enter a link that starts with http:// or https://.`);
		if (i?.text === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.text === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.text === "edit") return /** @type {LocalizedString} */ (`Edit ${i?.name}`);
		if (i?.text === "delete") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		if (i?.text === "delete_confirm") return /** @type {LocalizedString} */ (`Remove ${i?.name}? It stays on the timeline.`);
		if (i?.text === "mark_done") return /** @type {LocalizedString} */ (`Mark ${i?.name} as done`);
		if (i?.text === "mark_open") return /** @type {LocalizedString} */ (`Reopen ${i?.name}`);
		if (i?.text === "due_on") return /** @type {LocalizedString} */ (`Due ${i?.date}`);
		if (i?.text === "overdue") return /** @type {LocalizedString} */ (`Overdue since ${i?.date}`);
		if (i?.text === "done_on") return /** @type {LocalizedString} */ (`Done ${i?.date}`);
		if (i?.text === "open_link") return /** @type {LocalizedString} */ (`Open issue`);
		if (i?.text === "owner_former") return /** @type {LocalizedString} */ (`Former member`);
		if (i?.text === "done_count") return /** @type {LocalizedString} */ (`Done: ${i?.count}`);
		if (i?.text === "limit") return /** @type {LocalizedString} */ (`This incident has as many follow-ups as it can hold. Remove a done one first.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Couldn't change ${i?.name}: ${i?.reason}`);
		if (i?.text === "read_only") return /** @type {LocalizedString} */ (`Only responders, admins and owners change follow-ups.`);
		if (i?.text === "open_title") return /** @type {LocalizedString} */ (`Open follow-ups`);
		if (i?.text === "open_description") return /** @type {LocalizedString} */ (`Every open follow-up in the workspace, soonest due first.`);
		if (i?.text === "open_empty") return /** @type {LocalizedString} */ (`Nothing open. Follow-ups added to incidents show up here until they're done.`);
		if (i?.text === "open_link_all") return /** @type {LocalizedString} */ (`All open follow-ups`);
		if (i?.text === "overdue_count") return /** @type {LocalizedString} */ (`Overdue: ${i?.count}`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Loading follow-ups…`);
		if (i?.text === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load follow-ups: ${i?.reason}`);
		if (i?.text === "incident_column") return /** @type {LocalizedString} */ (`Incident`);
		if (i?.text === "mine_filter") return /** @type {LocalizedString} */ (`Whose follow-ups`);
		if (i?.text === "all") return /** @type {LocalizedString} */ (`All`);
		if (i?.text === "mine") return /** @type {LocalizedString} */ (`Mine`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Overview`);
		if (i?.text === "title_required") return /** @type {LocalizedString} */ (`Say what needs doing.`);
		return /** @type {LocalizedString} */ (`Follow-ups`)
	}
});