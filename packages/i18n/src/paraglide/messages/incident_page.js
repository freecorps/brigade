/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Incident_PageInputs */



/**
* | part | output |
* | --- | --- |
* | "back" | "All incidents" |
* | "loading" | "Loading the incident…" |
* | "not_found" | "There is no incident with this number in this workspace." |
* | "roles" | "Roles" |
* | "timeline" | "Timeline" |
* | "timeline_empty" | "Nothing on the timeline yet." |
* | "update_label" | "Post an update" |
* | "update_placeholder" | "What do you know now? What happens next?" |
* | "update_hint" | "Everyone in the workspace sees it on the timeline." |
* | "update_empty" | "Write the update first." |
* | "update_invalid" | "Remove invisible, control or bidi characters and try again." |
* | "post" | "Post update" |
* | "nobody" | "Unassigned" |
* | "unassign" | "Unassign" |
* | "no_members" | "Teammates show up here once they have opened Brigade." |
* | "you" | "You" |
* | "you_object" | "you" |
* | "monitors" | "A monitor" |
* | "teammate" | "A teammate" |
* | "read_only" | "Viewers follow the incident; responders and admins change it." |
* | "not_found_title" | "Incident not found" |
* | "load_failed_title" | "Couldn't load the incident" |
* | "unnamed" | "Unnamed member" |
* | "show_more" | "Show more" |
* | "show_less" | "Show less" |
* | "show_names" | "Show names" |
* | "hide_names" | "Hide names" |
* | * | "Incident" |
*
* @param {Incident_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_page = /** @type {((inputs: Incident_PageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_PageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "back") return /** @type {LocalizedString} */ (`Todos os incidentes`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Carregando o incidente…`);
		if (i?.part === "not_found") return /** @type {LocalizedString} */ (`Não há incidente com este número neste espaço de trabalho.`);
		if (i?.part === "roles") return /** @type {LocalizedString} */ (`Papéis`);
		if (i?.part === "timeline") return /** @type {LocalizedString} */ (`Linha do tempo`);
		if (i?.part === "timeline_empty") return /** @type {LocalizedString} */ (`Nada na linha do tempo ainda.`);
		if (i?.part === "update_label") return /** @type {LocalizedString} */ (`Publicar uma atualização`);
		if (i?.part === "update_placeholder") return /** @type {LocalizedString} */ (`O que vocês sabem agora? O que vem a seguir?`);
		if (i?.part === "update_hint") return /** @type {LocalizedString} */ (`Todos no espaço de trabalho veem na linha do tempo.`);
		if (i?.part === "update_empty") return /** @type {LocalizedString} */ (`Escreva a atualização primeiro.`);
		if (i?.part === "update_invalid") return /** @type {LocalizedString} */ (`Remova caracteres invisíveis, de controle ou bidi e tente de novo.`);
		if (i?.part === "post") return /** @type {LocalizedString} */ (`Publicar atualização`);
		if (i?.part === "nobody") return /** @type {LocalizedString} */ (`Sem responsável`);
		if (i?.part === "unassign") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "no_members") return /** @type {LocalizedString} */ (`As pessoas do time aparecem aqui depois de abrirem o Brigade.`);
		if (i?.part === "you") return /** @type {LocalizedString} */ (`Você`);
		if (i?.part === "you_object") return /** @type {LocalizedString} */ (`você`);
		if (i?.part === "monitors") return /** @type {LocalizedString} */ (`Um monitor`);
		if (i?.part === "teammate") return /** @type {LocalizedString} */ (`Alguém do time`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Leitores acompanham o incidente; respondedores e admins o alteram.`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`Incidente não encontrado`);
		if (i?.part === "load_failed_title") return /** @type {LocalizedString} */ (`Não foi possível carregar o incidente`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Membro sem nome`);
		if (i?.part === "show_more") return /** @type {LocalizedString} */ (`Mostrar mais`);
		if (i?.part === "show_less") return /** @type {LocalizedString} */ (`Mostrar menos`);
		if (i?.part === "show_names") return /** @type {LocalizedString} */ (`Mostrar nomes`);
		if (i?.part === "hide_names") return /** @type {LocalizedString} */ (`Ocultar nomes`);
		return /** @type {LocalizedString} */ (`Incidente`)
	}
	{
		if (i?.part === "back") return /** @type {LocalizedString} */ (`All incidents`);
		if (i?.part === "loading") return /** @type {LocalizedString} */ (`Loading the incident…`);
		if (i?.part === "not_found") return /** @type {LocalizedString} */ (`There is no incident with this number in this workspace.`);
		if (i?.part === "roles") return /** @type {LocalizedString} */ (`Roles`);
		if (i?.part === "timeline") return /** @type {LocalizedString} */ (`Timeline`);
		if (i?.part === "timeline_empty") return /** @type {LocalizedString} */ (`Nothing on the timeline yet.`);
		if (i?.part === "update_label") return /** @type {LocalizedString} */ (`Post an update`);
		if (i?.part === "update_placeholder") return /** @type {LocalizedString} */ (`What do you know now? What happens next?`);
		if (i?.part === "update_hint") return /** @type {LocalizedString} */ (`Everyone in the workspace sees it on the timeline.`);
		if (i?.part === "update_empty") return /** @type {LocalizedString} */ (`Write the update first.`);
		if (i?.part === "update_invalid") return /** @type {LocalizedString} */ (`Remove invisible, control or bidi characters and try again.`);
		if (i?.part === "post") return /** @type {LocalizedString} */ (`Post update`);
		if (i?.part === "nobody") return /** @type {LocalizedString} */ (`Unassigned`);
		if (i?.part === "unassign") return /** @type {LocalizedString} */ (`Unassign`);
		if (i?.part === "no_members") return /** @type {LocalizedString} */ (`Teammates show up here once they have opened Brigade.`);
		if (i?.part === "you") return /** @type {LocalizedString} */ (`You`);
		if (i?.part === "you_object") return /** @type {LocalizedString} */ (`you`);
		if (i?.part === "monitors") return /** @type {LocalizedString} */ (`A monitor`);
		if (i?.part === "teammate") return /** @type {LocalizedString} */ (`A teammate`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Viewers follow the incident; responders and admins change it.`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`Incident not found`);
		if (i?.part === "load_failed_title") return /** @type {LocalizedString} */ (`Couldn't load the incident`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Unnamed member`);
		if (i?.part === "show_more") return /** @type {LocalizedString} */ (`Show more`);
		if (i?.part === "show_less") return /** @type {LocalizedString} */ (`Show less`);
		if (i?.part === "show_names") return /** @type {LocalizedString} */ (`Show names`);
		if (i?.part === "hide_names") return /** @type {LocalizedString} */ (`Hide names`);
		return /** @type {LocalizedString} */ (`Incident`)
	}
});