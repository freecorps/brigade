/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, name: NonNullable<unknown>, workspace: NonNullable<unknown>, list: NonNullable<unknown>, detail: NonNullable<unknown>, person: NonNullable<unknown> }} Slack_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "message_declared_by" | "Declared by {name}" |
* | "message_acknowledged_by" | "Acknowledged by {name}" |
* | "message_not_acknowledged" | "Nobody has acknowledged it yet" |
* | "message_ack_button" | "Acknowledge" |
* | "message_open_button" | "Open in Brigade" |
* | "message_monitors" | "Brigade monitors" |
* | "message_unnamed" | "an unnamed member" |
* | "message_teammate" | "a teammate" |
* | "reply_declared" | "Declared {incident}: {title}" |
* | "reply_acknowledged" | "Acknowledged {incident}: {title}. Paging has stopped." |
* | "reply_already" | "{incident} is already acknowledged." |
* | "reply_not_active" | "{incident} is no longer active." |
* | "reply_not_found" | "There's no such incident in {workspace}." |
* | "reply_ambiguous" | "More than one incident is waiting to be acknowledged: {list}. Say which one, for example /inc ack {incident}." |
* | "reply_none" | "No active incident is waiting to be acknowledged." |
* | "reply_forbidden" | "Your role in {workspace} can't do that. Ask an owner or admin." |
* | "reply_unmapped" | "Your Slack email isn't the confirmed email of a member of {workspace} in Brigade, so Brigade can't act for you. Use the same email in both and confirm it in ..." |
* | "reply_unconfirmed" | "Brigade can't tell who you are: Slack hasn't confirmed your email, or you're a guest from another Slack workspace." |
* | "reply_not_connected" | "This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard." |
* | "reply_reconnect" | "Brigade can't use this Slack workspace's connection any more. An owner or admin needs to connect Slack again from the Brigade dashboard." |
* | "reply_invalid_title" | "An incident needs a title of 1 to 200 characters, with no invisible characters." |
* | "reply_failed" | "Brigade couldn't do that right now. Try again in a moment." |
* | "reply_unknown" | "Unknown command." |
* | "usage" | "Declare an incident: /inc declare [title] [sev1 to sev4], or /inc declare alone for a form. Then: /inc ack, /inc update <text>, /inc sev <1 to 4>, /inc resol..." |
* | "message_channel" | "Incident channel: {detail}" |
* | "mirror_status" | "{name} changed the status to *{detail}*" |
* | "mirror_severity" | "{name} changed the severity to *{detail}*" |
* | "mirror_ack" | "{name} acknowledged the incident. Paging has stopped." |
* | "mirror_role" | "{name} made {person} the {detail}" |
* | "mirror_role_cleared" | "{name} left the {detail} role empty" |
* | "mirror_update" | "*Update from {name}* {detail}" |
* | "reply_updated" | "Posted to {incident}'s timeline." |
* | "reply_severity" | "{incident} is now {detail}." |
* | "reply_resolved" | "Resolved {incident}: {title}" |
* | "reply_role" | "{person} is now the {detail} of {incident}." |
* | "reply_escalated" | "Paged the next level of {incident} now." |
* | "reply_not_escalating" | "{incident} has no escalation under way, so there's no next level to page." |
* | "reply_unchanged" | "{incident} is already like that." |
* | "reply_which" | "More than one incident is active: {list}. Say which one, for example /inc {detail} {incident}." |
* | "reply_no_active" | "No incident is active." |
* | "reply_invalid_update" | "An update needs 1 to 4000 characters, with no invisible characters." |
* | "reply_unknown_role" | "There's no role called {detail}. The roles are: {list}." |
* | "reply_role_unmapped" | "Brigade can't tell which member {person} is: their Slack email isn't the confirmed email of a member of {workspace}." |
* | "reply_role_viewer" | "{person} is a viewer in {workspace}, and viewers can't hold incident roles." |
* | "reply_not_incident_channel" | "This isn't an incident's channel. To post to an incident's timeline, use /inc update INC-12 followed by the update." |
* | "reply_modal_failed" | "Brigade couldn't open the form. Try /inc declare followed by the title instead." |
* | "modal_title" | "Declare an incident" |
* | "modal_submit" | "Declare" |
* | "modal_close" | "Cancel" |
* | "modal_title_label" | "Title" |
* | "modal_title_placeholder" | "What's wrong, in a few words" |
* | "modal_severity_label" | "Severity" |
* | "modal_type_label" | "Type" |
* | "modal_type_placeholder" | "Pick a type" |
* | "modal_services_label" | "Affected services" |
* | "modal_services_placeholder" | "Pick services" |
* | * | "Brigade" |
*
* @param {Slack_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const slack_text = /** @type {((inputs: Slack_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "message_declared_by") return /** @type {LocalizedString} */ (`Declarado por ${i?.name}`);
		if (i?.part === "message_acknowledged_by") return /** @type {LocalizedString} */ (`Confirmado por ${i?.name}`);
		if (i?.part === "message_not_acknowledged") return /** @type {LocalizedString} */ (`Ninguém confirmou ainda`);
		if (i?.part === "message_ack_button") return /** @type {LocalizedString} */ (`Confirmar`);
		if (i?.part === "message_open_button") return /** @type {LocalizedString} */ (`Abrir no Brigade`);
		if (i?.part === "message_monitors") return /** @type {LocalizedString} */ (`Monitores do Brigade`);
		if (i?.part === "message_unnamed") return /** @type {LocalizedString} */ (`um membro sem nome`);
		if (i?.part === "message_teammate") return /** @type {LocalizedString} */ (`um colega`);
		if (i?.part === "reply_declared") return /** @type {LocalizedString} */ (`${i?.incident} declarado: ${i?.title}`);
		if (i?.part === "reply_acknowledged") return /** @type {LocalizedString} */ (`${i?.incident} confirmado: ${i?.title}. As chamadas pararam.`);
		if (i?.part === "reply_already") return /** @type {LocalizedString} */ (`${i?.incident} já foi confirmado.`);
		if (i?.part === "reply_not_active") return /** @type {LocalizedString} */ (`${i?.incident} não está mais ativo.`);
		if (i?.part === "reply_not_found") return /** @type {LocalizedString} */ (`Esse incidente não existe em ${i?.workspace}.`);
		if (i?.part === "reply_ambiguous") return /** @type {LocalizedString} */ (`Há mais de um incidente esperando confirmação: ${i?.list}. Diga qual, por exemplo /inc ack ${i?.incident}.`);
		if (i?.part === "reply_none") return /** @type {LocalizedString} */ (`Nenhum incidente ativo está esperando confirmação.`);
		if (i?.part === "reply_forbidden") return /** @type {LocalizedString} */ (`Seu papel em ${i?.workspace} não permite isso. Peça a um proprietário ou administrador.`);
		if (i?.part === "reply_unmapped") return /** @type {LocalizedString} */ (`Seu email do Slack não é o email confirmado de um membro de ${i?.workspace} no Brigade, então o Brigade não pode agir por você. Use o mesmo email nos dois e confirme-o no Brigade, ou peça a um proprietário para adicionar você.`);
		if (i?.part === "reply_unconfirmed") return /** @type {LocalizedString} */ (`O Brigade não consegue saber quem você é: o Slack ainda não confirmou seu email, ou você é convidado de outro workspace do Slack.`);
		if (i?.part === "reply_not_connected") return /** @type {LocalizedString} */ (`Este workspace do Slack não está conectado ao Brigade. Um proprietário ou administrador pode conectá-lo pelo painel do Brigade.`);
		if (i?.part === "reply_reconnect") return /** @type {LocalizedString} */ (`O Brigade não consegue mais usar a conexão deste workspace do Slack. Um proprietário ou administrador precisa conectar o Slack de novo pelo painel do Brigade.`);
		if (i?.part === "reply_invalid_title") return /** @type {LocalizedString} */ (`Um incidente precisa de um título de 1 a 200 caracteres, sem caracteres invisíveis.`);
		if (i?.part === "reply_failed") return /** @type {LocalizedString} */ (`O Brigade não conseguiu fazer isso agora. Tente de novo em instantes.`);
		if (i?.part === "reply_unknown") return /** @type {LocalizedString} */ (`Comando desconhecido.`);
		if (i?.part === "usage") return /** @type {LocalizedString} */ (`Declarar um incidente: /inc declare [título] [sev1 a sev4], ou só /inc declare para um formulário. Depois: /inc ack, /inc update <texto>, /inc sev <1 a 4>, /inc resolve, /inc role <papel> @alguém e /inc escalate, cada um com o número de um incidente como INC-12 antes do resto, ou sem ele no canal de um incidente.`);
		if (i?.part === "message_channel") return /** @type {LocalizedString} */ (`Canal do incidente: ${i?.detail}`);
		if (i?.part === "mirror_status") return /** @type {LocalizedString} */ (`${i?.name} mudou o status para *${i?.detail}*`);
		if (i?.part === "mirror_severity") return /** @type {LocalizedString} */ (`${i?.name} mudou a gravidade para *${i?.detail}*`);
		if (i?.part === "mirror_ack") return /** @type {LocalizedString} */ (`${i?.name} confirmou o incidente. As chamadas pararam.`);
		if (i?.part === "mirror_role") return /** @type {LocalizedString} */ (`${i?.name} definiu ${i?.person} como ${i?.detail}`);
		if (i?.part === "mirror_role_cleared") return /** @type {LocalizedString} */ (`${i?.name} deixou o papel de ${i?.detail} sem ninguém`);
		if (i?.part === "mirror_update") return /** @type {LocalizedString} */ (`*Atualização de ${i?.name}*
${i?.detail}`);
		if (i?.part === "reply_updated") return /** @type {LocalizedString} */ (`Publicado na linha do tempo do ${i?.incident}.`);
		if (i?.part === "reply_severity") return /** @type {LocalizedString} */ (`${i?.incident} agora é ${i?.detail}.`);
		if (i?.part === "reply_resolved") return /** @type {LocalizedString} */ (`${i?.incident} resolvido: ${i?.title}`);
		if (i?.part === "reply_role") return /** @type {LocalizedString} */ (`${i?.person} agora é ${i?.detail} do ${i?.incident}.`);
		if (i?.part === "reply_escalated") return /** @type {LocalizedString} */ (`O próximo nível do ${i?.incident} foi chamado agora.`);
		if (i?.part === "reply_not_escalating") return /** @type {LocalizedString} */ (`O ${i?.incident} não tem um escalonamento em andamento, então não há próximo nível para chamar.`);
		if (i?.part === "reply_unchanged") return /** @type {LocalizedString} */ (`O ${i?.incident} já está assim.`);
		if (i?.part === "reply_which") return /** @type {LocalizedString} */ (`Há mais de um incidente ativo: ${i?.list}. Diga qual, por exemplo /inc ${i?.detail} ${i?.incident}.`);
		if (i?.part === "reply_no_active") return /** @type {LocalizedString} */ (`Nenhum incidente está ativo.`);
		if (i?.part === "reply_invalid_update") return /** @type {LocalizedString} */ (`Uma atualização precisa de 1 a 4000 caracteres, sem caracteres invisíveis.`);
		if (i?.part === "reply_unknown_role") return /** @type {LocalizedString} */ (`Não existe um papel chamado ${i?.detail}. Os papéis são: ${i?.list}.`);
		if (i?.part === "reply_role_unmapped") return /** @type {LocalizedString} */ (`O Brigade não sabe qual membro é ${i?.person}: o email dessa pessoa no Slack não é o email confirmado de um membro de ${i?.workspace}.`);
		if (i?.part === "reply_role_viewer") return /** @type {LocalizedString} */ (`${i?.person} é leitor em ${i?.workspace}, e leitores não podem ter papéis em incidentes.`);
		if (i?.part === "reply_not_incident_channel") return /** @type {LocalizedString} */ (`Este não é o canal de um incidente. Para publicar na linha do tempo de um incidente, use /inc update INC-12 seguido da atualização.`);
		if (i?.part === "reply_modal_failed") return /** @type {LocalizedString} */ (`O Brigade não conseguiu abrir o formulário. Tente /inc declare seguido do título.`);
		if (i?.part === "modal_title") return /** @type {LocalizedString} */ (`Declarar incidente`);
		if (i?.part === "modal_submit") return /** @type {LocalizedString} */ (`Declarar`);
		if (i?.part === "modal_close") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "modal_title_label") return /** @type {LocalizedString} */ (`Título`);
		if (i?.part === "modal_title_placeholder") return /** @type {LocalizedString} */ (`O que está errado, em poucas palavras`);
		if (i?.part === "modal_severity_label") return /** @type {LocalizedString} */ (`Gravidade`);
		if (i?.part === "modal_type_label") return /** @type {LocalizedString} */ (`Tipo`);
		if (i?.part === "modal_type_placeholder") return /** @type {LocalizedString} */ (`Escolha um tipo`);
		if (i?.part === "modal_services_label") return /** @type {LocalizedString} */ (`Serviços afetados`);
		if (i?.part === "modal_services_placeholder") return /** @type {LocalizedString} */ (`Escolha serviços`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "message_declared_by") return /** @type {LocalizedString} */ (`Declared by ${i?.name}`);
		if (i?.part === "message_acknowledged_by") return /** @type {LocalizedString} */ (`Acknowledged by ${i?.name}`);
		if (i?.part === "message_not_acknowledged") return /** @type {LocalizedString} */ (`Nobody has acknowledged it yet`);
		if (i?.part === "message_ack_button") return /** @type {LocalizedString} */ (`Acknowledge`);
		if (i?.part === "message_open_button") return /** @type {LocalizedString} */ (`Open in Brigade`);
		if (i?.part === "message_monitors") return /** @type {LocalizedString} */ (`Brigade monitors`);
		if (i?.part === "message_unnamed") return /** @type {LocalizedString} */ (`an unnamed member`);
		if (i?.part === "message_teammate") return /** @type {LocalizedString} */ (`a teammate`);
		if (i?.part === "reply_declared") return /** @type {LocalizedString} */ (`Declared ${i?.incident}: ${i?.title}`);
		if (i?.part === "reply_acknowledged") return /** @type {LocalizedString} */ (`Acknowledged ${i?.incident}: ${i?.title}. Paging has stopped.`);
		if (i?.part === "reply_already") return /** @type {LocalizedString} */ (`${i?.incident} is already acknowledged.`);
		if (i?.part === "reply_not_active") return /** @type {LocalizedString} */ (`${i?.incident} is no longer active.`);
		if (i?.part === "reply_not_found") return /** @type {LocalizedString} */ (`There's no such incident in ${i?.workspace}.`);
		if (i?.part === "reply_ambiguous") return /** @type {LocalizedString} */ (`More than one incident is waiting to be acknowledged: ${i?.list}. Say which one, for example /inc ack ${i?.incident}.`);
		if (i?.part === "reply_none") return /** @type {LocalizedString} */ (`No active incident is waiting to be acknowledged.`);
		if (i?.part === "reply_forbidden") return /** @type {LocalizedString} */ (`Your role in ${i?.workspace} can't do that. Ask an owner or admin.`);
		if (i?.part === "reply_unmapped") return /** @type {LocalizedString} */ (`Your Slack email isn't the confirmed email of a member of ${i?.workspace} in Brigade, so Brigade can't act for you. Use the same email in both and confirm it in Brigade, or ask an owner to add you.`);
		if (i?.part === "reply_unconfirmed") return /** @type {LocalizedString} */ (`Brigade can't tell who you are: Slack hasn't confirmed your email, or you're a guest from another Slack workspace.`);
		if (i?.part === "reply_not_connected") return /** @type {LocalizedString} */ (`This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard.`);
		if (i?.part === "reply_reconnect") return /** @type {LocalizedString} */ (`Brigade can't use this Slack workspace's connection any more. An owner or admin needs to connect Slack again from the Brigade dashboard.`);
		if (i?.part === "reply_invalid_title") return /** @type {LocalizedString} */ (`An incident needs a title of 1 to 200 characters, with no invisible characters.`);
		if (i?.part === "reply_failed") return /** @type {LocalizedString} */ (`Brigade couldn't do that right now. Try again in a moment.`);
		if (i?.part === "reply_unknown") return /** @type {LocalizedString} */ (`Unknown command.`);
		if (i?.part === "usage") return /** @type {LocalizedString} */ (`Declare an incident: /inc declare [title] [sev1 to sev4], or /inc declare alone for a form. Then: /inc ack, /inc update <text>, /inc sev <1 to 4>, /inc resolve, /inc role <role> @someone and /inc escalate, each with an incident number such as INC-12 before the rest, or without one in an incident's channel.`);
		if (i?.part === "message_channel") return /** @type {LocalizedString} */ (`Incident channel: ${i?.detail}`);
		if (i?.part === "mirror_status") return /** @type {LocalizedString} */ (`${i?.name} changed the status to *${i?.detail}*`);
		if (i?.part === "mirror_severity") return /** @type {LocalizedString} */ (`${i?.name} changed the severity to *${i?.detail}*`);
		if (i?.part === "mirror_ack") return /** @type {LocalizedString} */ (`${i?.name} acknowledged the incident. Paging has stopped.`);
		if (i?.part === "mirror_role") return /** @type {LocalizedString} */ (`${i?.name} made ${i?.person} the ${i?.detail}`);
		if (i?.part === "mirror_role_cleared") return /** @type {LocalizedString} */ (`${i?.name} left the ${i?.detail} role empty`);
		if (i?.part === "mirror_update") return /** @type {LocalizedString} */ (`*Update from ${i?.name}*
${i?.detail}`);
		if (i?.part === "reply_updated") return /** @type {LocalizedString} */ (`Posted to ${i?.incident}'s timeline.`);
		if (i?.part === "reply_severity") return /** @type {LocalizedString} */ (`${i?.incident} is now ${i?.detail}.`);
		if (i?.part === "reply_resolved") return /** @type {LocalizedString} */ (`Resolved ${i?.incident}: ${i?.title}`);
		if (i?.part === "reply_role") return /** @type {LocalizedString} */ (`${i?.person} is now the ${i?.detail} of ${i?.incident}.`);
		if (i?.part === "reply_escalated") return /** @type {LocalizedString} */ (`Paged the next level of ${i?.incident} now.`);
		if (i?.part === "reply_not_escalating") return /** @type {LocalizedString} */ (`${i?.incident} has no escalation under way, so there's no next level to page.`);
		if (i?.part === "reply_unchanged") return /** @type {LocalizedString} */ (`${i?.incident} is already like that.`);
		if (i?.part === "reply_which") return /** @type {LocalizedString} */ (`More than one incident is active: ${i?.list}. Say which one, for example /inc ${i?.detail} ${i?.incident}.`);
		if (i?.part === "reply_no_active") return /** @type {LocalizedString} */ (`No incident is active.`);
		if (i?.part === "reply_invalid_update") return /** @type {LocalizedString} */ (`An update needs 1 to 4000 characters, with no invisible characters.`);
		if (i?.part === "reply_unknown_role") return /** @type {LocalizedString} */ (`There's no role called ${i?.detail}. The roles are: ${i?.list}.`);
		if (i?.part === "reply_role_unmapped") return /** @type {LocalizedString} */ (`Brigade can't tell which member ${i?.person} is: their Slack email isn't the confirmed email of a member of ${i?.workspace}.`);
		if (i?.part === "reply_role_viewer") return /** @type {LocalizedString} */ (`${i?.person} is a viewer in ${i?.workspace}, and viewers can't hold incident roles.`);
		if (i?.part === "reply_not_incident_channel") return /** @type {LocalizedString} */ (`This isn't an incident's channel. To post to an incident's timeline, use /inc update INC-12 followed by the update.`);
		if (i?.part === "reply_modal_failed") return /** @type {LocalizedString} */ (`Brigade couldn't open the form. Try /inc declare followed by the title instead.`);
		if (i?.part === "modal_title") return /** @type {LocalizedString} */ (`Declare an incident`);
		if (i?.part === "modal_submit") return /** @type {LocalizedString} */ (`Declare`);
		if (i?.part === "modal_close") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "modal_title_label") return /** @type {LocalizedString} */ (`Title`);
		if (i?.part === "modal_title_placeholder") return /** @type {LocalizedString} */ (`What's wrong, in a few words`);
		if (i?.part === "modal_severity_label") return /** @type {LocalizedString} */ (`Severity`);
		if (i?.part === "modal_type_label") return /** @type {LocalizedString} */ (`Type`);
		if (i?.part === "modal_type_placeholder") return /** @type {LocalizedString} */ (`Pick a type`);
		if (i?.part === "modal_services_label") return /** @type {LocalizedString} */ (`Affected services`);
		if (i?.part === "modal_services_placeholder") return /** @type {LocalizedString} */ (`Pick services`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});