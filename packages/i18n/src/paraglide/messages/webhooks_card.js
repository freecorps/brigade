/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown>, when: NonNullable<unknown> }} Webhooks_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Webhooks" |
* | "description" | "Send signed JSON to your own services when incidents, alerts and monitors change." |
* | "add" | "Add endpoint" |
* | "manage_only" | "Only owners and admins can see and manage webhooks." |
* | "empty" | "No endpoints yet. Add one to get incidents, alerts and monitor changes as signed JSON." |
* | "load_failed" | "Couldn't load the webhooks." |
* | "retry" | "Try again" |
* | "not_configured" | "Webhooks aren't set up on this Brigade server." |
* | "limit" | "A workspace can have at most 20 endpoints. Delete one to add another." |
* | "url_label" | "Endpoint URL" |
* | "url_hint" | "HTTPS only, on a public host. Brigade doesn't follow redirects." |
* | "url_invalid" | "Enter an https:// URL on a public host, without a user name or password." |
* | "description_label" | "Description" |
* | "description_hint" | "Optional. Shown here instead of the host." |
* | "description_invalid" | "Use at most 200 visible characters." |
* | "events_label" | "Events" |
* | "events_none" | "Pick at least one event." |
* | "events_all" | "All" |
* | "group_incidents" | "Incidents" |
* | "group_monitors" | "Monitors and alerts" |
* | "group_escalation" | "Escalation" |
* | "create" | "Add endpoint" |
* | "creating" | "Adding…" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "saved" | "Saved." |
* | "cancel" | "Cancel" |
* | "save_failed" | "Couldn't save. Try again." |
* | "exists" | "This endpoint already exists. Give it a new secret if you missed the first one." |
* | "status_on" | "On" |
* | "status_off" | "Off" |
* | "status_failing" | "Off: failing" |
* | "last_ok" | "Delivered {when}" |
* | "last_failed" | "Last delivery failed {when}" |
* | "never" | "No deliveries yet" |
* | "failing_since" | "Failing since {when}" |
* | "disabled_failing" | "Brigade turned this endpoint off {when}, after its deliveries kept failing for a day. Fix the endpoint, then turn it back on." |
* | "edit" | "Edit" |
* | "close_edit" | "Done" |
* | "turn_on" | "Turn on" |
* | "turn_off" | "Turn off" |
* | "toggle_failed" | "Couldn't change it. Try again." |
* | "test" | "Send test event" |
* | "testing" | "Sending…" |
* | "test_sent" | "Test event on its way. It shows under Recent deliveries." |
* | "test_too_soon" | "A test event went out moments ago. Wait a few seconds." |
* | "test_failed" | "Couldn't send a test event. Try again." |
* | "rotate" | "New secret" |
* | "rotate_confirm" | "Give {host} a new signing secret? Deliveries are signed with both for 24 hours, so the receiver can switch over." |
* | "rotate_go" | "Make new secret" |
* | "rotating" | "Making…" |
* | "rotate_failed" | "Couldn't make a new secret. Try again." |
* | "keep" | "Keep current" |
* | "delete" | "Delete" |
* | "delete_confirm" | "Delete {host}? Deliveries stop at once and its log is gone." |
* | "delete_go" | "Delete endpoint" |
* | "deleting" | "Deleting…" |
* | "delete_failed" | "Couldn't delete. Try again." |
* | "secret_created" | "Copy the signing secret for {host} now: Brigade won't show it again." |
* | "secret_rotated" | "New signing secret for {host}. Copy it now: Brigade won't show it again." |
* | "secret_label" | "Signing secret" |
* | "secret_verify" | "Check the webhook-signature header with any Standard Webhooks library, using this secret." |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "copy_key" | "Press Ctrl+C to copy it." |
* | "copy_key_apple" | "Press ⌘C to copy it." |
* | "close_prompt" | "Close without copying? You'd have to make a new secret." |
* | "keep_open" | "Keep it open" |
* | "close" | "Close" |
* | "recent_title" | "Recent deliveries" |
* | "recent_empty" | "Nothing delivered yet. Send a test event to try the endpoint." |
* | "attempt" | "Try {when}" |
* | "headers_label" | "Custom headers" |
* | "headers_hint" | "Optional, up to 5. Sent with every delivery, for example Authorization for your receiver. Brigade keeps the values sealed and never shows them again." |
* | "headers_none" | "No custom headers." |
* | "headers_edit" | "Edit headers" |
* | "headers_save" | "Save headers" |
* | "headers_saving" | "Saving…" |
* | "headers_saved" | "Headers saved." |
* | "headers_failed" | "Couldn't save the headers. Try again." |
* | "headers_refused" | "Brigade refused this header. Check its name and value." |
* | "headers_limit" | "Use at most 5 headers." |
* | "header_add" | "Add header" |
* | "header_remove" | "Remove header" |
* | "header_name" | "Header name" |
* | "header_value" | "Value" |
* | "header_keep" | "Unchanged" |
* | "header_name_invalid" | "Use letters, digits and hyphens, like X-Team." |
* | "header_reserved" | "Brigade sets this header itself." |
* | "header_duplicate" | "This header is listed twice." |
* | "header_value_required" | "Enter a value." |
* | "header_value_invalid" | "Use up to 1024 plain ASCII characters, without line breaks." |
* | "header_hidden" | "value hidden" |
* | "header_hint" | "ends in {when}" |
* | "replay" | "Replay" |
* | "replaying" | "Replaying…" |
* | "replay_sent" | "Replay on its way, with the same webhook-id. It shows at the top of Recent deliveries." |
* | "replay_too_soon" | "A delivery was replayed moments ago, or this endpoint reached its replays for the hour. Wait a little." |
* | "replay_off" | "Turn this endpoint on to replay a delivery." |
* | "replay_gone" | "Brigade no longer keeps this delivery, so it can't be replayed." |
* | "replay_failed" | "Couldn't replay it. Try again." |
* | "replayed" | "Replay" |
* | * | "Webhooks" |
*
* @param {Webhooks_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const webhooks_card = /** @type {((inputs: Webhooks_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhooks_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Webhooks`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Envie JSON assinado para os seus próprios serviços quando incidentes, alertas e monitores mudam.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar endpoint`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só proprietários e administradores podem ver e gerenciar webhooks.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhum endpoint ainda. Adicione um para receber incidentes, alertas e mudanças de monitores como JSON assinado.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar os webhooks.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`Os webhooks não estão configurados neste servidor do Brigade.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Um workspace pode ter no máximo 20 endpoints. Exclua um para adicionar outro.`);
		if (i?.part === "url_label") return /** @type {LocalizedString} */ (`URL do endpoint`);
		if (i?.part === "url_hint") return /** @type {LocalizedString} */ (`Só HTTPS, em um host público. O Brigade não segue redirecionamentos.`);
		if (i?.part === "url_invalid") return /** @type {LocalizedString} */ (`Digite uma URL https:// em um host público, sem usuário nem senha.`);
		if (i?.part === "description_label") return /** @type {LocalizedString} */ (`Descrição`);
		if (i?.part === "description_hint") return /** @type {LocalizedString} */ (`Opcional. Aparece aqui no lugar do host.`);
		if (i?.part === "description_invalid") return /** @type {LocalizedString} */ (`Use no máximo 200 caracteres visíveis.`);
		if (i?.part === "events_label") return /** @type {LocalizedString} */ (`Eventos`);
		if (i?.part === "events_none") return /** @type {LocalizedString} */ (`Escolha pelo menos um evento.`);
		if (i?.part === "events_all") return /** @type {LocalizedString} */ (`Todos`);
		if (i?.part === "group_incidents") return /** @type {LocalizedString} */ (`Incidentes`);
		if (i?.part === "group_monitors") return /** @type {LocalizedString} */ (`Monitores e alertas`);
		if (i?.part === "group_escalation") return /** @type {LocalizedString} */ (`Escalonamento`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Adicionar endpoint`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Adicionando…`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar. Tente de novo.`);
		if (i?.part === "exists") return /** @type {LocalizedString} */ (`Este endpoint já existe. Gere um novo segredo se você perdeu o primeiro.`);
		if (i?.part === "status_on") return /** @type {LocalizedString} */ (`Ligado`);
		if (i?.part === "status_off") return /** @type {LocalizedString} */ (`Desligado`);
		if (i?.part === "status_failing") return /** @type {LocalizedString} */ (`Desligado: falhando`);
		if (i?.part === "last_ok") return /** @type {LocalizedString} */ (`Entregue ${i?.when}`);
		if (i?.part === "last_failed") return /** @type {LocalizedString} */ (`A última entrega falhou ${i?.when}`);
		if (i?.part === "never") return /** @type {LocalizedString} */ (`Nenhuma entrega ainda`);
		if (i?.part === "failing_since") return /** @type {LocalizedString} */ (`Falhando desde ${i?.when}`);
		if (i?.part === "disabled_failing") return /** @type {LocalizedString} */ (`O Brigade desligou este endpoint ${i?.when}, depois que as entregas falharam por um dia. Corrija o endpoint e ligue-o de novo.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "close_edit") return /** @type {LocalizedString} */ (`Concluir`);
		if (i?.part === "turn_on") return /** @type {LocalizedString} */ (`Ligar`);
		if (i?.part === "turn_off") return /** @type {LocalizedString} */ (`Desligar`);
		if (i?.part === "toggle_failed") return /** @type {LocalizedString} */ (`Não foi possível mudar. Tente de novo.`);
		if (i?.part === "test") return /** @type {LocalizedString} */ (`Enviar evento de teste`);
		if (i?.part === "testing") return /** @type {LocalizedString} */ (`Enviando…`);
		if (i?.part === "test_sent") return /** @type {LocalizedString} */ (`Evento de teste a caminho. Ele aparece em Entregas recentes.`);
		if (i?.part === "test_too_soon") return /** @type {LocalizedString} */ (`Um evento de teste acabou de sair. Espere alguns segundos.`);
		if (i?.part === "test_failed") return /** @type {LocalizedString} */ (`Não foi possível enviar um evento de teste. Tente de novo.`);
		if (i?.part === "rotate") return /** @type {LocalizedString} */ (`Novo segredo`);
		if (i?.part === "rotate_confirm") return /** @type {LocalizedString} */ (`Dar um novo segredo de assinatura a ${i?.host}? As entregas são assinadas com os dois por 24 horas, para o receptor fazer a troca.`);
		if (i?.part === "rotate_go") return /** @type {LocalizedString} */ (`Gerar novo segredo`);
		if (i?.part === "rotating") return /** @type {LocalizedString} */ (`Gerando…`);
		if (i?.part === "rotate_failed") return /** @type {LocalizedString} */ (`Não foi possível gerar um novo segredo. Tente de novo.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter o atual`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Excluir`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Excluir ${i?.host}? As entregas param na hora e o histórico some.`);
		if (i?.part === "delete_go") return /** @type {LocalizedString} */ (`Excluir endpoint`);
		if (i?.part === "deleting") return /** @type {LocalizedString} */ (`Excluindo…`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Não foi possível excluir. Tente de novo.`);
		if (i?.part === "secret_created") return /** @type {LocalizedString} */ (`Copie agora o segredo de assinatura de ${i?.host}: o Brigade não vai mostrá-lo de novo.`);
		if (i?.part === "secret_rotated") return /** @type {LocalizedString} */ (`Novo segredo de assinatura de ${i?.host}. Copie agora: o Brigade não vai mostrá-lo de novo.`);
		if (i?.part === "secret_label") return /** @type {LocalizedString} */ (`Segredo de assinatura`);
		if (i?.part === "secret_verify") return /** @type {LocalizedString} */ (`Confira o cabeçalho webhook-signature com qualquer biblioteca do Standard Webhooks, usando este segredo.`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copiar`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copiado`);
		if (i?.part === "copy_key") return /** @type {LocalizedString} */ (`Pressione Ctrl+C para copiar.`);
		if (i?.part === "copy_key_apple") return /** @type {LocalizedString} */ (`Pressione ⌘C para copiar.`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Fechar sem copiar? Você teria que gerar um novo segredo.`);
		if (i?.part === "keep_open") return /** @type {LocalizedString} */ (`Manter aberto`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar`);
		if (i?.part === "recent_title") return /** @type {LocalizedString} */ (`Entregas recentes`);
		if (i?.part === "recent_empty") return /** @type {LocalizedString} */ (`Nada entregue ainda. Envie um evento de teste para experimentar o endpoint.`);
		if (i?.part === "attempt") return /** @type {LocalizedString} */ (`Tentativa ${i?.when}`);
		if (i?.part === "headers_label") return /** @type {LocalizedString} */ (`Cabeçalhos personalizados`);
		if (i?.part === "headers_hint") return /** @type {LocalizedString} */ (`Opcional, até 5. Enviados em cada entrega, por exemplo Authorization para o seu receptor. O Brigade guarda os valores selados e nunca os mostra de novo.`);
		if (i?.part === "headers_none") return /** @type {LocalizedString} */ (`Nenhum cabeçalho personalizado.`);
		if (i?.part === "headers_edit") return /** @type {LocalizedString} */ (`Editar cabeçalhos`);
		if (i?.part === "headers_save") return /** @type {LocalizedString} */ (`Salvar cabeçalhos`);
		if (i?.part === "headers_saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "headers_saved") return /** @type {LocalizedString} */ (`Cabeçalhos salvos.`);
		if (i?.part === "headers_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar os cabeçalhos. Tente de novo.`);
		if (i?.part === "headers_refused") return /** @type {LocalizedString} */ (`O Brigade recusou este cabeçalho. Confira o nome e o valor.`);
		if (i?.part === "headers_limit") return /** @type {LocalizedString} */ (`Use no máximo 5 cabeçalhos.`);
		if (i?.part === "header_add") return /** @type {LocalizedString} */ (`Adicionar cabeçalho`);
		if (i?.part === "header_remove") return /** @type {LocalizedString} */ (`Remover cabeçalho`);
		if (i?.part === "header_name") return /** @type {LocalizedString} */ (`Nome do cabeçalho`);
		if (i?.part === "header_value") return /** @type {LocalizedString} */ (`Valor`);
		if (i?.part === "header_keep") return /** @type {LocalizedString} */ (`Sem alteração`);
		if (i?.part === "header_name_invalid") return /** @type {LocalizedString} */ (`Use letras, dígitos e hifens, como X-Team.`);
		if (i?.part === "header_reserved") return /** @type {LocalizedString} */ (`O Brigade define este cabeçalho por conta própria.`);
		if (i?.part === "header_duplicate") return /** @type {LocalizedString} */ (`Este cabeçalho aparece duas vezes.`);
		if (i?.part === "header_value_required") return /** @type {LocalizedString} */ (`Informe um valor.`);
		if (i?.part === "header_value_invalid") return /** @type {LocalizedString} */ (`Use até 1024 caracteres ASCII simples, sem quebras de linha.`);
		if (i?.part === "header_hidden") return /** @type {LocalizedString} */ (`valor oculto`);
		if (i?.part === "header_hint") return /** @type {LocalizedString} */ (`termina em ${i?.when}`);
		if (i?.part === "replay") return /** @type {LocalizedString} */ (`Reenviar`);
		if (i?.part === "replaying") return /** @type {LocalizedString} */ (`Reenviando…`);
		if (i?.part === "replay_sent") return /** @type {LocalizedString} */ (`Reenvio a caminho, com o mesmo webhook-id. Ele aparece no topo de Entregas recentes.`);
		if (i?.part === "replay_too_soon") return /** @type {LocalizedString} */ (`Uma entrega foi reenviada há pouco, ou este endpoint atingiu o limite de reenvios da hora. Aguarde um pouco.`);
		if (i?.part === "replay_off") return /** @type {LocalizedString} */ (`Ligue este endpoint para reenviar uma entrega.`);
		if (i?.part === "replay_gone") return /** @type {LocalizedString} */ (`O Brigade não guarda mais esta entrega, então ela não pode ser reenviada.`);
		if (i?.part === "replay_failed") return /** @type {LocalizedString} */ (`Não foi possível reenviar. Tente de novo.`);
		if (i?.part === "replayed") return /** @type {LocalizedString} */ (`Reenvio`);
		return /** @type {LocalizedString} */ (`Webhooks`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Webhooks`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Send signed JSON to your own services when incidents, alerts and monitors change.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add endpoint`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins can see and manage webhooks.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No endpoints yet. Add one to get incidents, alerts and monitor changes as signed JSON.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the webhooks.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`Webhooks aren't set up on this Brigade server.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`A workspace can have at most 20 endpoints. Delete one to add another.`);
		if (i?.part === "url_label") return /** @type {LocalizedString} */ (`Endpoint URL`);
		if (i?.part === "url_hint") return /** @type {LocalizedString} */ (`HTTPS only, on a public host. Brigade doesn't follow redirects.`);
		if (i?.part === "url_invalid") return /** @type {LocalizedString} */ (`Enter an https:// URL on a public host, without a user name or password.`);
		if (i?.part === "description_label") return /** @type {LocalizedString} */ (`Description`);
		if (i?.part === "description_hint") return /** @type {LocalizedString} */ (`Optional. Shown here instead of the host.`);
		if (i?.part === "description_invalid") return /** @type {LocalizedString} */ (`Use at most 200 visible characters.`);
		if (i?.part === "events_label") return /** @type {LocalizedString} */ (`Events`);
		if (i?.part === "events_none") return /** @type {LocalizedString} */ (`Pick at least one event.`);
		if (i?.part === "events_all") return /** @type {LocalizedString} */ (`All`);
		if (i?.part === "group_incidents") return /** @type {LocalizedString} */ (`Incidents`);
		if (i?.part === "group_monitors") return /** @type {LocalizedString} */ (`Monitors and alerts`);
		if (i?.part === "group_escalation") return /** @type {LocalizedString} */ (`Escalation`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Add endpoint`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Adding…`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Couldn't save. Try again.`);
		if (i?.part === "exists") return /** @type {LocalizedString} */ (`This endpoint already exists. Give it a new secret if you missed the first one.`);
		if (i?.part === "status_on") return /** @type {LocalizedString} */ (`On`);
		if (i?.part === "status_off") return /** @type {LocalizedString} */ (`Off`);
		if (i?.part === "status_failing") return /** @type {LocalizedString} */ (`Off: failing`);
		if (i?.part === "last_ok") return /** @type {LocalizedString} */ (`Delivered ${i?.when}`);
		if (i?.part === "last_failed") return /** @type {LocalizedString} */ (`Last delivery failed ${i?.when}`);
		if (i?.part === "never") return /** @type {LocalizedString} */ (`No deliveries yet`);
		if (i?.part === "failing_since") return /** @type {LocalizedString} */ (`Failing since ${i?.when}`);
		if (i?.part === "disabled_failing") return /** @type {LocalizedString} */ (`Brigade turned this endpoint off ${i?.when}, after its deliveries kept failing for a day. Fix the endpoint, then turn it back on.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "close_edit") return /** @type {LocalizedString} */ (`Done`);
		if (i?.part === "turn_on") return /** @type {LocalizedString} */ (`Turn on`);
		if (i?.part === "turn_off") return /** @type {LocalizedString} */ (`Turn off`);
		if (i?.part === "toggle_failed") return /** @type {LocalizedString} */ (`Couldn't change it. Try again.`);
		if (i?.part === "test") return /** @type {LocalizedString} */ (`Send test event`);
		if (i?.part === "testing") return /** @type {LocalizedString} */ (`Sending…`);
		if (i?.part === "test_sent") return /** @type {LocalizedString} */ (`Test event on its way. It shows under Recent deliveries.`);
		if (i?.part === "test_too_soon") return /** @type {LocalizedString} */ (`A test event went out moments ago. Wait a few seconds.`);
		if (i?.part === "test_failed") return /** @type {LocalizedString} */ (`Couldn't send a test event. Try again.`);
		if (i?.part === "rotate") return /** @type {LocalizedString} */ (`New secret`);
		if (i?.part === "rotate_confirm") return /** @type {LocalizedString} */ (`Give ${i?.host} a new signing secret? Deliveries are signed with both for 24 hours, so the receiver can switch over.`);
		if (i?.part === "rotate_go") return /** @type {LocalizedString} */ (`Make new secret`);
		if (i?.part === "rotating") return /** @type {LocalizedString} */ (`Making…`);
		if (i?.part === "rotate_failed") return /** @type {LocalizedString} */ (`Couldn't make a new secret. Try again.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep current`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Delete`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Delete ${i?.host}? Deliveries stop at once and its log is gone.`);
		if (i?.part === "delete_go") return /** @type {LocalizedString} */ (`Delete endpoint`);
		if (i?.part === "deleting") return /** @type {LocalizedString} */ (`Deleting…`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Couldn't delete. Try again.`);
		if (i?.part === "secret_created") return /** @type {LocalizedString} */ (`Copy the signing secret for ${i?.host} now: Brigade won't show it again.`);
		if (i?.part === "secret_rotated") return /** @type {LocalizedString} */ (`New signing secret for ${i?.host}. Copy it now: Brigade won't show it again.`);
		if (i?.part === "secret_label") return /** @type {LocalizedString} */ (`Signing secret`);
		if (i?.part === "secret_verify") return /** @type {LocalizedString} */ (`Check the webhook-signature header with any Standard Webhooks library, using this secret.`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copy`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copied`);
		if (i?.part === "copy_key") return /** @type {LocalizedString} */ (`Press Ctrl+C to copy it.`);
		if (i?.part === "copy_key_apple") return /** @type {LocalizedString} */ (`Press ⌘C to copy it.`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Close without copying? You'd have to make a new secret.`);
		if (i?.part === "keep_open") return /** @type {LocalizedString} */ (`Keep it open`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close`);
		if (i?.part === "recent_title") return /** @type {LocalizedString} */ (`Recent deliveries`);
		if (i?.part === "recent_empty") return /** @type {LocalizedString} */ (`Nothing delivered yet. Send a test event to try the endpoint.`);
		if (i?.part === "attempt") return /** @type {LocalizedString} */ (`Try ${i?.when}`);
		if (i?.part === "headers_label") return /** @type {LocalizedString} */ (`Custom headers`);
		if (i?.part === "headers_hint") return /** @type {LocalizedString} */ (`Optional, up to 5. Sent with every delivery, for example Authorization for your receiver. Brigade keeps the values sealed and never shows them again.`);
		if (i?.part === "headers_none") return /** @type {LocalizedString} */ (`No custom headers.`);
		if (i?.part === "headers_edit") return /** @type {LocalizedString} */ (`Edit headers`);
		if (i?.part === "headers_save") return /** @type {LocalizedString} */ (`Save headers`);
		if (i?.part === "headers_saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "headers_saved") return /** @type {LocalizedString} */ (`Headers saved.`);
		if (i?.part === "headers_failed") return /** @type {LocalizedString} */ (`Couldn't save the headers. Try again.`);
		if (i?.part === "headers_refused") return /** @type {LocalizedString} */ (`Brigade refused this header. Check its name and value.`);
		if (i?.part === "headers_limit") return /** @type {LocalizedString} */ (`Use at most 5 headers.`);
		if (i?.part === "header_add") return /** @type {LocalizedString} */ (`Add header`);
		if (i?.part === "header_remove") return /** @type {LocalizedString} */ (`Remove header`);
		if (i?.part === "header_name") return /** @type {LocalizedString} */ (`Header name`);
		if (i?.part === "header_value") return /** @type {LocalizedString} */ (`Value`);
		if (i?.part === "header_keep") return /** @type {LocalizedString} */ (`Unchanged`);
		if (i?.part === "header_name_invalid") return /** @type {LocalizedString} */ (`Use letters, digits and hyphens, like X-Team.`);
		if (i?.part === "header_reserved") return /** @type {LocalizedString} */ (`Brigade sets this header itself.`);
		if (i?.part === "header_duplicate") return /** @type {LocalizedString} */ (`This header is listed twice.`);
		if (i?.part === "header_value_required") return /** @type {LocalizedString} */ (`Enter a value.`);
		if (i?.part === "header_value_invalid") return /** @type {LocalizedString} */ (`Use up to 1024 plain ASCII characters, without line breaks.`);
		if (i?.part === "header_hidden") return /** @type {LocalizedString} */ (`value hidden`);
		if (i?.part === "header_hint") return /** @type {LocalizedString} */ (`ends in ${i?.when}`);
		if (i?.part === "replay") return /** @type {LocalizedString} */ (`Replay`);
		if (i?.part === "replaying") return /** @type {LocalizedString} */ (`Replaying…`);
		if (i?.part === "replay_sent") return /** @type {LocalizedString} */ (`Replay on its way, with the same webhook-id. It shows at the top of Recent deliveries.`);
		if (i?.part === "replay_too_soon") return /** @type {LocalizedString} */ (`A delivery was replayed moments ago, or this endpoint reached its replays for the hour. Wait a little.`);
		if (i?.part === "replay_off") return /** @type {LocalizedString} */ (`Turn this endpoint on to replay a delivery.`);
		if (i?.part === "replay_gone") return /** @type {LocalizedString} */ (`Brigade no longer keeps this delivery, so it can't be replayed.`);
		if (i?.part === "replay_failed") return /** @type {LocalizedString} */ (`Couldn't replay it. Try again.`);
		if (i?.part === "replayed") return /** @type {LocalizedString} */ (`Replay`);
		return /** @type {LocalizedString} */ (`Webhooks`)
	}
});