/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, level: NonNullable<unknown>, reason: NonNullable<unknown> }} Escalation_TextInputs */



/**
* | text | output |
* | --- | --- |
* | "title" | "Escalation" |
* | "empty" | "No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond." |
* | "no_default" | "No default policy: pages go to the incident's commander, or to everyone who can respond." |
* | "default_note" | "Every page, from a monitor or declared by hand, goes through the default policy." |
* | "default_badge" | "Default" |
* | "level" | "Level {level}" |
* | "level_empty" | "Nobody to page at this level: it is skipped until someone is added" |
* | "on_call" | "{name} on call now" |
* | "add_target_placeholder" | "Choose…" |
* | "delete_confirm" | "Delete {name}? Runs under way keep the levels they started with." |
* | "delete_default" | "It is the default: pages go back to the incident's commander, or to everyone who can respond." |
* | "change_failed" | "Couldn't change {name}: {reason}" |
* | "gone" | "The policy no longer exists." |
* | "dropped" | "People or schedules that are gone were taken out of this policy." |
* | "deleted_schedule" | "Deleted schedule" |
* | "hint" | "Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once." |
* | "next_label" | "Next" |
* | "paged_at" | "Paged {time}" |
* | "everyone" | "Everyone who can respond" |
* | "policy_named" | "Policy: {name}" |
* | "nobody_reached" | "Nobody reached" |
* | "target_schedule" | "Schedule" |
* | "target_member" | "Person" |
* | "group_schedules" | "Schedules (whoever is on call)" |
* | "group_people" | "People" |
* | * | "Escalation" |
*
* @param {Escalation_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_text = /** @type {((inputs: Escalation_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Escalonamento`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`Ainda não há políticas de escalonamento. Sem uma política padrão, as chamadas vão para o comandante do incidente, ou para todos que podem responder.`);
		if (i?.text === "no_default") return /** @type {LocalizedString} */ (`Nenhuma política padrão: as chamadas vão para o comandante do incidente, ou para todos que podem responder.`);
		if (i?.text === "default_note") return /** @type {LocalizedString} */ (`Toda chamada, de um monitor ou declarada à mão, passa pela política padrão.`);
		if (i?.text === "default_badge") return /** @type {LocalizedString} */ (`Padrão`);
		if (i?.text === "level") return /** @type {LocalizedString} */ (`Nível ${i?.level}`);
		if (i?.text === "level_empty") return /** @type {LocalizedString} */ (`Ninguém para chamar neste nível: ele é pulado até alguém ser adicionado`);
		if (i?.text === "on_call") return /** @type {LocalizedString} */ (`${i?.name} de plantão agora`);
		if (i?.text === "add_target_placeholder") return /** @type {LocalizedString} */ (`Escolher…`);
		if (i?.text === "delete_confirm") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Escalonamentos em andamento mantêm os níveis com que começaram.`);
		if (i?.text === "delete_default") return /** @type {LocalizedString} */ (`É a política padrão: as chamadas voltam a ir para o comandante do incidente, ou para todos que podem responder.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Não foi possível alterar ${i?.name}: ${i?.reason}`);
		if (i?.text === "gone") return /** @type {LocalizedString} */ (`A política não existe mais.`);
		if (i?.text === "dropped") return /** @type {LocalizedString} */ (`Pessoas ou escalas que não existem mais foram retiradas desta política.`);
		if (i?.text === "deleted_schedule") return /** @type {LocalizedString} */ (`Escala excluída`);
		if (i?.text === "hint") return /** @type {LocalizedString} */ (`Os níveis chamam em ordem até alguém confirmar. Uma escala chama quem estiver de plantão quando o nível dispara; um nível em que ninguém pode ser alcançado é pulado na hora.`);
		if (i?.text === "next_label") return /** @type {LocalizedString} */ (`Próximo`);
		if (i?.text === "paged_at") return /** @type {LocalizedString} */ (`Chamado ${i?.time}`);
		if (i?.text === "everyone") return /** @type {LocalizedString} */ (`Todos que podem responder`);
		if (i?.text === "policy_named") return /** @type {LocalizedString} */ (`Política: ${i?.name}`);
		if (i?.text === "nobody_reached") return /** @type {LocalizedString} */ (`Ninguém alcançado`);
		if (i?.text === "target_schedule") return /** @type {LocalizedString} */ (`Escala`);
		if (i?.text === "target_member") return /** @type {LocalizedString} */ (`Pessoa`);
		if (i?.text === "group_schedules") return /** @type {LocalizedString} */ (`Escalas (quem estiver de plantão)`);
		if (i?.text === "group_people") return /** @type {LocalizedString} */ (`Pessoas`);
		return /** @type {LocalizedString} */ (`Escalonamento`)
	}
	{
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Escalation`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`No escalation policies yet. Without a default policy, pages go to the incident's commander, or to everyone who can respond.`);
		if (i?.text === "no_default") return /** @type {LocalizedString} */ (`No default policy: pages go to the incident's commander, or to everyone who can respond.`);
		if (i?.text === "default_note") return /** @type {LocalizedString} */ (`Every page, from a monitor or declared by hand, goes through the default policy.`);
		if (i?.text === "default_badge") return /** @type {LocalizedString} */ (`Default`);
		if (i?.text === "level") return /** @type {LocalizedString} */ (`Level ${i?.level}`);
		if (i?.text === "level_empty") return /** @type {LocalizedString} */ (`Nobody to page at this level: it is skipped until someone is added`);
		if (i?.text === "on_call") return /** @type {LocalizedString} */ (`${i?.name} on call now`);
		if (i?.text === "add_target_placeholder") return /** @type {LocalizedString} */ (`Choose…`);
		if (i?.text === "delete_confirm") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Runs under way keep the levels they started with.`);
		if (i?.text === "delete_default") return /** @type {LocalizedString} */ (`It is the default: pages go back to the incident's commander, or to everyone who can respond.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Couldn't change ${i?.name}: ${i?.reason}`);
		if (i?.text === "gone") return /** @type {LocalizedString} */ (`The policy no longer exists.`);
		if (i?.text === "dropped") return /** @type {LocalizedString} */ (`People or schedules that are gone were taken out of this policy.`);
		if (i?.text === "deleted_schedule") return /** @type {LocalizedString} */ (`Deleted schedule`);
		if (i?.text === "hint") return /** @type {LocalizedString} */ (`Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once.`);
		if (i?.text === "next_label") return /** @type {LocalizedString} */ (`Next`);
		if (i?.text === "paged_at") return /** @type {LocalizedString} */ (`Paged ${i?.time}`);
		if (i?.text === "everyone") return /** @type {LocalizedString} */ (`Everyone who can respond`);
		if (i?.text === "policy_named") return /** @type {LocalizedString} */ (`Policy: ${i?.name}`);
		if (i?.text === "nobody_reached") return /** @type {LocalizedString} */ (`Nobody reached`);
		if (i?.text === "target_schedule") return /** @type {LocalizedString} */ (`Schedule`);
		if (i?.text === "target_member") return /** @type {LocalizedString} */ (`Person`);
		if (i?.text === "group_schedules") return /** @type {LocalizedString} */ (`Schedules (whoever is on call)`);
		if (i?.text === "group_people") return /** @type {LocalizedString} */ (`People`);
		return /** @type {LocalizedString} */ (`Escalation`)
	}
});