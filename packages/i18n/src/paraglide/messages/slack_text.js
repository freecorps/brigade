/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, name: NonNullable<unknown>, workspace: NonNullable<unknown>, list: NonNullable<unknown> }} Slack_TextInputs */



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
* | "reply_unmapped" | "Your Slack email isn't the email of a member of {workspace} in Brigade, so Brigade can't act for you. Use the same email in both, or ask an owner to add you." |
* | "reply_unconfirmed" | "Slack hasn't confirmed your email address, so Brigade can't tell who you are." |
* | "reply_not_connected" | "This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard." |
* | "reply_invalid_title" | "An incident needs a title of 1 to 200 characters, with no invisible characters." |
* | "reply_failed" | "Brigade couldn't do that right now. Try again in a moment." |
* | "reply_unknown" | "Unknown command." |
* | "usage" | "Declare an incident: /inc declare <title> [sev1, sev2, sev3 or sev4]. Acknowledge one: /inc ack [INC-12]." |
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
		if (i?.part === "reply_unmapped") return /** @type {LocalizedString} */ (`Seu email do Slack não é o email de um membro de ${i?.workspace} no Brigade, então o Brigade não pode agir por você. Use o mesmo email nos dois ou peça a um proprietário para adicionar você.`);
		if (i?.part === "reply_unconfirmed") return /** @type {LocalizedString} */ (`O Slack ainda não confirmou seu email, então o Brigade não consegue saber quem você é.`);
		if (i?.part === "reply_not_connected") return /** @type {LocalizedString} */ (`Este workspace do Slack não está conectado ao Brigade. Um proprietário ou administrador pode conectá-lo pelo painel do Brigade.`);
		if (i?.part === "reply_invalid_title") return /** @type {LocalizedString} */ (`Um incidente precisa de um título de 1 a 200 caracteres, sem caracteres invisíveis.`);
		if (i?.part === "reply_failed") return /** @type {LocalizedString} */ (`O Brigade não conseguiu fazer isso agora. Tente de novo em instantes.`);
		if (i?.part === "reply_unknown") return /** @type {LocalizedString} */ (`Comando desconhecido.`);
		if (i?.part === "usage") return /** @type {LocalizedString} */ (`Declarar um incidente: /inc declare <título> [sev1, sev2, sev3 ou sev4]. Confirmar um: /inc ack [INC-12].`);
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
		if (i?.part === "reply_unmapped") return /** @type {LocalizedString} */ (`Your Slack email isn't the email of a member of ${i?.workspace} in Brigade, so Brigade can't act for you. Use the same email in both, or ask an owner to add you.`);
		if (i?.part === "reply_unconfirmed") return /** @type {LocalizedString} */ (`Slack hasn't confirmed your email address, so Brigade can't tell who you are.`);
		if (i?.part === "reply_not_connected") return /** @type {LocalizedString} */ (`This Slack workspace isn't connected to Brigade. An owner or admin can connect it from the Brigade dashboard.`);
		if (i?.part === "reply_invalid_title") return /** @type {LocalizedString} */ (`An incident needs a title of 1 to 200 characters, with no invisible characters.`);
		if (i?.part === "reply_failed") return /** @type {LocalizedString} */ (`Brigade couldn't do that right now. Try again in a moment.`);
		if (i?.part === "reply_unknown") return /** @type {LocalizedString} */ (`Unknown command.`);
		if (i?.part === "usage") return /** @type {LocalizedString} */ (`Declare an incident: /inc declare <title> [sev1, sev2, sev3 or sev4]. Acknowledge one: /inc ack [INC-12].`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});