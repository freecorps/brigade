/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, team: NonNullable<unknown>, channel: NonNullable<unknown> }} Slack_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Slack" |
* | "description" | "Run incidents from Slack with /inc, post each one in a channel and mirror its timeline there." |
* | "add" | "Add to Slack" |
* | "adding" | "Opening Slack…" |
* | "connected" | "Connected to {team}" |
* | "load_failed" | "Couldn't load the Slack connection, so Brigade can't tell whether it's connected." |
* | "retry" | "Try again" |
* | "not_connected" | "Not connected to a Slack workspace." |
* | "channel_label" | "Channel" |
* | "channel_hint" | "Each incident gets a message here. Private channels show up once Brigade is invited to them." |
* | "channel_invalid" | "A channel ID starts with C or G, followed by capital letters and numbers." |
* | "channel_none" | "No channel yet, so incidents aren't posted to Slack." |
* | "channel_current" | "Incidents are posted in {channel}." |
* | "language_label" | "Language of channel messages" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "saved" | "Saved." |
* | "save_failed" | "Couldn't save. Try again." |
* | "disconnect" | "Disconnect" |
* | "disconnecting" | "Disconnecting…" |
* | "disconnect_confirm" | "Disconnect {team}? /inc stops working there, incidents are no longer posted, and Brigade gives its access back to Slack." |
* | "disconnect_cancel" | "Keep connected" |
* | "disconnect_failed" | "Couldn't disconnect. Try again." |
* | "manage_only" | "Only owners and admins can connect Slack or change where incidents are posted." |
* | "result_connected" | "Slack is connected. Pick a channel for incidents." |
* | "result_cancelled" | "Connecting Slack was cancelled." |
* | "result_team_taken" | "That Slack workspace is already connected to another Brigade workspace." |
* | "result_not_configured" | "Slack isn't set up on this Brigade server." |
* | "result_failed" | "Couldn't connect Slack. Try again." |
* | "channel_pick" | "Pick a channel" |
* | "channel_none_option" | "No channel" |
* | "channel_loading" | "Loading channels from Slack…" |
* | "channel_list_failed" | "Couldn't load the channels from Slack. Enter the channel's ID instead." |
* | "channel_reload" | "Reload channels" |
* | "channel_id_label" | "Channel ID" |
* | "channel_id_hint" | "In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited." |
* | "channel_private" | "{channel} (private)" |
* | "channel_unlisted" | "{channel} (not in the list)" |
* | "incident_channels_label" | "A channel per incident" |
* | "incident_channels_hint" | "Brigade creates a channel such as #inc-12-checkout-down, invites the incident's roles and whoever is paged, and posts the timeline there." |
* | "incident_channels_off" | "Off" |
* | "incident_channels_all" | "For every incident" |
* | "incident_channels_major" | "For SEV1 and SEV2 only" |
* | "private_label" | "Make incident channels private" |
* | "archive_label" | "When the incident is resolved" |
* | "archive_keep" | "Keep its channel" |
* | "archive_0" | "Archive its channel right away" |
* | "archive_1" | "Archive its channel after an hour" |
* | "archive_24" | "Archive its channel after a day" |
* | "archive_168" | "Archive its channel after a week" |
* | "revoked_uninstalled" | "Brigade was removed from {team} in Slack, so nothing is posted there. Connect Slack again to resume." |
* | "revoked_tokens_revoked" | "Slack revoked Brigade's access to {team}, so nothing is posted there. Connect Slack again to resume." |
* | "reconnect" | "Connect again" |
* | * | "Slack" |
*
* @param {Slack_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const slack_card = /** @type {((inputs: Slack_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Slack_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Slack`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Conduza incidentes pelo Slack com /inc, publique cada um em um canal e espelhe a linha do tempo lá.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar ao Slack`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Abrindo o Slack…`);
		if (i?.part === "connected") return /** @type {LocalizedString} */ (`Conectado a ${i?.team}`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar a conexão com o Slack, então o Brigade não sabe se ela existe.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "not_connected") return /** @type {LocalizedString} */ (`Não conectado a um workspace do Slack.`);
		if (i?.part === "channel_label") return /** @type {LocalizedString} */ (`Canal`);
		if (i?.part === "channel_hint") return /** @type {LocalizedString} */ (`Cada incidente ganha uma mensagem aqui. Canais privados aparecem depois que o Brigade é convidado para eles.`);
		if (i?.part === "channel_invalid") return /** @type {LocalizedString} */ (`Um ID de canal começa com C ou G, seguido de letras maiúsculas e números.`);
		if (i?.part === "channel_none") return /** @type {LocalizedString} */ (`Nenhum canal ainda, então os incidentes não são publicados no Slack.`);
		if (i?.part === "channel_current") return /** @type {LocalizedString} */ (`Os incidentes são publicados em ${i?.channel}.`);
		if (i?.part === "language_label") return /** @type {LocalizedString} */ (`Idioma das mensagens no canal`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo.`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar. Tente de novo.`);
		if (i?.part === "disconnect") return /** @type {LocalizedString} */ (`Desconectar`);
		if (i?.part === "disconnecting") return /** @type {LocalizedString} */ (`Desconectando…`);
		if (i?.part === "disconnect_confirm") return /** @type {LocalizedString} */ (`Desconectar ${i?.team}? O /inc deixa de funcionar lá, os incidentes não são mais publicados e o Brigade devolve seu acesso ao Slack.`);
		if (i?.part === "disconnect_cancel") return /** @type {LocalizedString} */ (`Manter conectado`);
		if (i?.part === "disconnect_failed") return /** @type {LocalizedString} */ (`Não foi possível desconectar. Tente de novo.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só proprietários e administradores podem conectar o Slack ou mudar onde os incidentes são publicados.`);
		if (i?.part === "result_connected") return /** @type {LocalizedString} */ (`O Slack está conectado. Escolha um canal para os incidentes.`);
		if (i?.part === "result_cancelled") return /** @type {LocalizedString} */ (`A conexão com o Slack foi cancelada.`);
		if (i?.part === "result_team_taken") return /** @type {LocalizedString} */ (`Esse workspace do Slack já está conectado a outro workspace do Brigade.`);
		if (i?.part === "result_not_configured") return /** @type {LocalizedString} */ (`O Slack não está configurado neste servidor do Brigade.`);
		if (i?.part === "result_failed") return /** @type {LocalizedString} */ (`Não foi possível conectar o Slack. Tente de novo.`);
		if (i?.part === "channel_pick") return /** @type {LocalizedString} */ (`Escolha um canal`);
		if (i?.part === "channel_none_option") return /** @type {LocalizedString} */ (`Nenhum canal`);
		if (i?.part === "channel_loading") return /** @type {LocalizedString} */ (`Carregando os canais do Slack…`);
		if (i?.part === "channel_list_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar os canais do Slack. Digite o ID do canal.`);
		if (i?.part === "channel_reload") return /** @type {LocalizedString} */ (`Recarregar canais`);
		if (i?.part === "channel_id_label") return /** @type {LocalizedString} */ (`ID do canal`);
		if (i?.part === "channel_id_hint") return /** @type {LocalizedString} */ (`No Slack, abra os detalhes do canal e copie o ID no final. Ele começa com C, ou G para um canal privado, no qual o Brigade precisa ser convidado.`);
		if (i?.part === "channel_private") return /** @type {LocalizedString} */ (`${i?.channel} (privado)`);
		if (i?.part === "channel_unlisted") return /** @type {LocalizedString} */ (`${i?.channel} (fora da lista)`);
		if (i?.part === "incident_channels_label") return /** @type {LocalizedString} */ (`Um canal por incidente`);
		if (i?.part === "incident_channels_hint") return /** @type {LocalizedString} */ (`O Brigade cria um canal como #inc-12-checkout-fora, convida os papéis do incidente e quem for chamado, e publica a linha do tempo lá.`);
		if (i?.part === "incident_channels_off") return /** @type {LocalizedString} */ (`Desligado`);
		if (i?.part === "incident_channels_all") return /** @type {LocalizedString} */ (`Para todo incidente`);
		if (i?.part === "incident_channels_major") return /** @type {LocalizedString} */ (`Só para SEV1 e SEV2`);
		if (i?.part === "private_label") return /** @type {LocalizedString} */ (`Tornar os canais de incidente privados`);
		if (i?.part === "archive_label") return /** @type {LocalizedString} */ (`Quando o incidente for resolvido`);
		if (i?.part === "archive_keep") return /** @type {LocalizedString} */ (`Manter o canal`);
		if (i?.part === "archive_0") return /** @type {LocalizedString} */ (`Arquivar o canal na hora`);
		if (i?.part === "archive_1") return /** @type {LocalizedString} */ (`Arquivar o canal depois de uma hora`);
		if (i?.part === "archive_24") return /** @type {LocalizedString} */ (`Arquivar o canal depois de um dia`);
		if (i?.part === "archive_168") return /** @type {LocalizedString} */ (`Arquivar o canal depois de uma semana`);
		if (i?.part === "revoked_uninstalled") return /** @type {LocalizedString} */ (`O Brigade foi removido de ${i?.team} no Slack, então nada é publicado lá. Conecte o Slack de novo para voltar.`);
		if (i?.part === "revoked_tokens_revoked") return /** @type {LocalizedString} */ (`O Slack revogou o acesso do Brigade a ${i?.team}, então nada é publicado lá. Conecte o Slack de novo para voltar.`);
		if (i?.part === "reconnect") return /** @type {LocalizedString} */ (`Conectar de novo`);
		return /** @type {LocalizedString} */ (`Slack`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Slack`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Run incidents from Slack with /inc, post each one in a channel and mirror its timeline there.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add to Slack`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Opening Slack…`);
		if (i?.part === "connected") return /** @type {LocalizedString} */ (`Connected to ${i?.team}`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the Slack connection, so Brigade can't tell whether it's connected.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "not_connected") return /** @type {LocalizedString} */ (`Not connected to a Slack workspace.`);
		if (i?.part === "channel_label") return /** @type {LocalizedString} */ (`Channel`);
		if (i?.part === "channel_hint") return /** @type {LocalizedString} */ (`Each incident gets a message here. Private channels show up once Brigade is invited to them.`);
		if (i?.part === "channel_invalid") return /** @type {LocalizedString} */ (`A channel ID starts with C or G, followed by capital letters and numbers.`);
		if (i?.part === "channel_none") return /** @type {LocalizedString} */ (`No channel yet, so incidents aren't posted to Slack.`);
		if (i?.part === "channel_current") return /** @type {LocalizedString} */ (`Incidents are posted in ${i?.channel}.`);
		if (i?.part === "language_label") return /** @type {LocalizedString} */ (`Language of channel messages`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved.`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Couldn't save. Try again.`);
		if (i?.part === "disconnect") return /** @type {LocalizedString} */ (`Disconnect`);
		if (i?.part === "disconnecting") return /** @type {LocalizedString} */ (`Disconnecting…`);
		if (i?.part === "disconnect_confirm") return /** @type {LocalizedString} */ (`Disconnect ${i?.team}? /inc stops working there, incidents are no longer posted, and Brigade gives its access back to Slack.`);
		if (i?.part === "disconnect_cancel") return /** @type {LocalizedString} */ (`Keep connected`);
		if (i?.part === "disconnect_failed") return /** @type {LocalizedString} */ (`Couldn't disconnect. Try again.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins can connect Slack or change where incidents are posted.`);
		if (i?.part === "result_connected") return /** @type {LocalizedString} */ (`Slack is connected. Pick a channel for incidents.`);
		if (i?.part === "result_cancelled") return /** @type {LocalizedString} */ (`Connecting Slack was cancelled.`);
		if (i?.part === "result_team_taken") return /** @type {LocalizedString} */ (`That Slack workspace is already connected to another Brigade workspace.`);
		if (i?.part === "result_not_configured") return /** @type {LocalizedString} */ (`Slack isn't set up on this Brigade server.`);
		if (i?.part === "result_failed") return /** @type {LocalizedString} */ (`Couldn't connect Slack. Try again.`);
		if (i?.part === "channel_pick") return /** @type {LocalizedString} */ (`Pick a channel`);
		if (i?.part === "channel_none_option") return /** @type {LocalizedString} */ (`No channel`);
		if (i?.part === "channel_loading") return /** @type {LocalizedString} */ (`Loading channels from Slack…`);
		if (i?.part === "channel_list_failed") return /** @type {LocalizedString} */ (`Couldn't load the channels from Slack. Enter the channel's ID instead.`);
		if (i?.part === "channel_reload") return /** @type {LocalizedString} */ (`Reload channels`);
		if (i?.part === "channel_id_label") return /** @type {LocalizedString} */ (`Channel ID`);
		if (i?.part === "channel_id_hint") return /** @type {LocalizedString} */ (`In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited.`);
		if (i?.part === "channel_private") return /** @type {LocalizedString} */ (`${i?.channel} (private)`);
		if (i?.part === "channel_unlisted") return /** @type {LocalizedString} */ (`${i?.channel} (not in the list)`);
		if (i?.part === "incident_channels_label") return /** @type {LocalizedString} */ (`A channel per incident`);
		if (i?.part === "incident_channels_hint") return /** @type {LocalizedString} */ (`Brigade creates a channel such as #inc-12-checkout-down, invites the incident's roles and whoever is paged, and posts the timeline there.`);
		if (i?.part === "incident_channels_off") return /** @type {LocalizedString} */ (`Off`);
		if (i?.part === "incident_channels_all") return /** @type {LocalizedString} */ (`For every incident`);
		if (i?.part === "incident_channels_major") return /** @type {LocalizedString} */ (`For SEV1 and SEV2 only`);
		if (i?.part === "private_label") return /** @type {LocalizedString} */ (`Make incident channels private`);
		if (i?.part === "archive_label") return /** @type {LocalizedString} */ (`When the incident is resolved`);
		if (i?.part === "archive_keep") return /** @type {LocalizedString} */ (`Keep its channel`);
		if (i?.part === "archive_0") return /** @type {LocalizedString} */ (`Archive its channel right away`);
		if (i?.part === "archive_1") return /** @type {LocalizedString} */ (`Archive its channel after an hour`);
		if (i?.part === "archive_24") return /** @type {LocalizedString} */ (`Archive its channel after a day`);
		if (i?.part === "archive_168") return /** @type {LocalizedString} */ (`Archive its channel after a week`);
		if (i?.part === "revoked_uninstalled") return /** @type {LocalizedString} */ (`Brigade was removed from ${i?.team} in Slack, so nothing is posted there. Connect Slack again to resume.`);
		if (i?.part === "revoked_tokens_revoked") return /** @type {LocalizedString} */ (`Slack revoked Brigade's access to ${i?.team}, so nothing is posted there. Connect Slack again to resume.`);
		if (i?.part === "reconnect") return /** @type {LocalizedString} */ (`Connect again`);
		return /** @type {LocalizedString} */ (`Slack`)
	}
});