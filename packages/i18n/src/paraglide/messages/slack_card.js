/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, team: NonNullable<unknown>, channel: NonNullable<unknown> }} Slack_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Slack" |
* | "description" | "Declare and acknowledge incidents from Slack with /inc, and keep one message per incident in a channel." |
* | "add" | "Add to Slack" |
* | "adding" | "Opening Slack…" |
* | "connected" | "Connected to {team}" |
* | "load_failed" | "Couldn't load the Slack connection, so Brigade can't tell whether it's connected." |
* | "retry" | "Try again" |
* | "not_connected" | "Not connected to a Slack workspace." |
* | "channel_label" | "Channel ID" |
* | "channel_hint" | "In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited." |
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
* | "disconnect_confirm" | "Disconnect {team}? /inc stops working there and incidents are no longer posted. To revoke Brigade's access, also remove the app in Slack's settings." |
* | "disconnect_cancel" | "Keep connected" |
* | "disconnect_failed" | "Couldn't disconnect. Try again." |
* | "manage_only" | "Only owners and admins can connect Slack or change where incidents are posted." |
* | "result_connected" | "Slack is connected. Pick a channel for incidents." |
* | "result_cancelled" | "Connecting Slack was cancelled." |
* | "result_team_taken" | "That Slack workspace is already connected to another Brigade workspace." |
* | "result_not_configured" | "Slack isn't set up on this Brigade server." |
* | "result_failed" | "Couldn't connect Slack. Try again." |
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
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Declare e confirme incidentes pelo Slack com /inc e mantenha uma mensagem por incidente em um canal.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar ao Slack`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Abrindo o Slack…`);
		if (i?.part === "connected") return /** @type {LocalizedString} */ (`Conectado a ${i?.team}`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar a conexão com o Slack, então o Brigade não sabe se ela existe.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "not_connected") return /** @type {LocalizedString} */ (`Não conectado a um workspace do Slack.`);
		if (i?.part === "channel_label") return /** @type {LocalizedString} */ (`ID do canal`);
		if (i?.part === "channel_hint") return /** @type {LocalizedString} */ (`No Slack, abra os detalhes do canal e copie o ID no final. Ele começa com C, ou G para um canal privado, no qual o Brigade precisa ser convidado.`);
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
		if (i?.part === "disconnect_confirm") return /** @type {LocalizedString} */ (`Desconectar ${i?.team}? O /inc deixa de funcionar lá e os incidentes não são mais publicados. Para revogar o acesso do Brigade, remova também o app nas configurações do Slack.`);
		if (i?.part === "disconnect_cancel") return /** @type {LocalizedString} */ (`Manter conectado`);
		if (i?.part === "disconnect_failed") return /** @type {LocalizedString} */ (`Não foi possível desconectar. Tente de novo.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só proprietários e administradores podem conectar o Slack ou mudar onde os incidentes são publicados.`);
		if (i?.part === "result_connected") return /** @type {LocalizedString} */ (`O Slack está conectado. Escolha um canal para os incidentes.`);
		if (i?.part === "result_cancelled") return /** @type {LocalizedString} */ (`A conexão com o Slack foi cancelada.`);
		if (i?.part === "result_team_taken") return /** @type {LocalizedString} */ (`Esse workspace do Slack já está conectado a outro workspace do Brigade.`);
		if (i?.part === "result_not_configured") return /** @type {LocalizedString} */ (`O Slack não está configurado neste servidor do Brigade.`);
		if (i?.part === "result_failed") return /** @type {LocalizedString} */ (`Não foi possível conectar o Slack. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Slack`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Slack`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Declare and acknowledge incidents from Slack with /inc, and keep one message per incident in a channel.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add to Slack`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Opening Slack…`);
		if (i?.part === "connected") return /** @type {LocalizedString} */ (`Connected to ${i?.team}`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the Slack connection, so Brigade can't tell whether it's connected.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "not_connected") return /** @type {LocalizedString} */ (`Not connected to a Slack workspace.`);
		if (i?.part === "channel_label") return /** @type {LocalizedString} */ (`Channel ID`);
		if (i?.part === "channel_hint") return /** @type {LocalizedString} */ (`In Slack, open the channel's details and copy the ID at the bottom. It starts with C, or G for a private channel, where Brigade must be invited.`);
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
		if (i?.part === "disconnect_confirm") return /** @type {LocalizedString} */ (`Disconnect ${i?.team}? /inc stops working there and incidents are no longer posted. To revoke Brigade's access, also remove the app in Slack's settings.`);
		if (i?.part === "disconnect_cancel") return /** @type {LocalizedString} */ (`Keep connected`);
		if (i?.part === "disconnect_failed") return /** @type {LocalizedString} */ (`Couldn't disconnect. Try again.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins can connect Slack or change where incidents are posted.`);
		if (i?.part === "result_connected") return /** @type {LocalizedString} */ (`Slack is connected. Pick a channel for incidents.`);
		if (i?.part === "result_cancelled") return /** @type {LocalizedString} */ (`Connecting Slack was cancelled.`);
		if (i?.part === "result_team_taken") return /** @type {LocalizedString} */ (`That Slack workspace is already connected to another Brigade workspace.`);
		if (i?.part === "result_not_configured") return /** @type {LocalizedString} */ (`Slack isn't set up on this Brigade server.`);
		if (i?.part === "result_failed") return /** @type {LocalizedString} */ (`Couldn't connect Slack. Try again.`);
		return /** @type {LocalizedString} */ (`Slack`)
	}
});