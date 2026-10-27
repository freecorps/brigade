/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, value: NonNullable<unknown> }} Alerts_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Alert sources" |
* | "description" | "Grafana, Datadog, Sentry or anything that sends a webhook posts alerts to a secret URL. Routes decide which alerts open incidents and who is paged." |
* | "load_failed" | "Couldn't load alert sources." |
* | "retry" | "Try again" |
* | "add" | "Add source" |
* | "sources_empty" | "No alert sources yet. Add one to get a URL to paste into your monitoring tool." |
* | "manage_only" | "Only owners and admins add alert sources and change routes." |
* | "name_label" | "Name" |
* | "name_required" | "Give the source a name." |
* | "kind_label" | "Sent by" |
* | "kind_generic" | "Any webhook" |
* | "kind_grafana" | "Grafana" |
* | "kind_datadog" | "Datadog" |
* | "kind_sentry" | "Sentry" |
* | "header_label" | "Extra header (optional)" |
* | "header_hint" | "Brigade also checks this header. For Basic auth, use Authorization." |
* | "header_value_label" | "Header value" |
* | "header_invalid" | "Use letters, digits and hyphens, and not a header the transport uses." |
* | "header_value_required" | "Enter the value the header carries." |
* | "secret_label_sentry" | "Client secret" |
* | "secret_hint_sentry" | "From your Sentry internal integration. Brigade checks every webhook's signature with it." |
* | "secret_label_grafana" | "HMAC secret (optional)" |
* | "secret_hint_grafana" | "Set the same secret in the contact point's HMAC signature settings." |
* | "secret_required" | "Sentry signs every webhook: paste its client secret." |
* | "secret_invalid" | "Use 8 to 256 characters, without spaces." |
* | "create" | "Create source" |
* | "creating" | "Creating…" |
* | "cancel" | "Cancel" |
* | "create_failed" | "Couldn't create the source. Try again." |
* | "limit" | "This workspace has as many alert sources as it can ({value}). Delete one to add another." |
* | "url_once" | "Copy this URL now. Brigade keeps only a hash of it, so it is shown once." |
* | "url_rotated" | "New URL for {name}. The old one no longer works." |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "close_prompt" | "Close without copying? You'd need a new URL." |
* | "keep" | "Keep it open" |
* | "close" | "Close" |
* | "setup_title" | "Where to paste it" |
* | "setup_grafana" | "In Grafana, open Alerting, then Contact points, and add a Webhook integration with this URL and the POST method. Then send a notification policy to that cont..." |
* | "setup_grafana_hmac" | "Under Optional Webhook settings, set HMAC Signature to the secret you gave Brigade. Keep the default signature header and leave the timestamp header empty." |
* | "setup_datadog" | "In Datadog, open Integrations, then Webhooks, and add a webhook named brigade with this URL and the payload below. Then add @webhook-brigade to a monitor's m..." |
* | "setup_sentry" | "In Sentry, open Settings, then Developer Settings, and create an internal integration with this webhook URL. Turn on Alert Rule Action, copy its client secre..." |
* | "setup_generic" | "POST JSON to this URL. Only title is required. Send the same dedup_key while the alert fires, and status resolved when it's over." |
* | "setup_header" | "Also send the header {name} with the value you entered." |
* | "setup_show" | "How to connect it" |
* | "last_received" | "Last alert {value}" |
* | "never_received" | "No alert received yet" |
* | "signed" | "Signature checked" |
* | "header_checked" | "Checks {name}" |
* | "rotate" | "New URL" |
* | "rotate_confirm" | "The current URL stops working at once. Update whatever sends to it." |
* | "rotate_failed" | "Couldn't make a new URL. The current one still works." |
* | "delete" | "Delete" |
* | "delete_confirm" | "Delete {name}? Its URL stops working and its firing alerts resolve. Incidents they opened stay open." |
* | "delete_failed" | "Couldn't delete it. Try again." |
* | "keep_source" | "Keep it" |
* | "routes_title" | "Alert routes" |
* | "routes_hint" | "Tried from the top: the first route that matches decides. An alert no route matches opens an incident at its own severity, paged through the default policy." |
* | "default_route" | "Everything else" |
* | "default_route_action" | "Opens an incident at the alert's severity, paged through the default policy. Unreadable payloads always come here." |
* | "route_name" | "Route name" |
* | "route_name_required" | "Give the route a name." |
* | "match_sources" | "From" |
* | "any_source" | "Any source" |
* | "match_severities" | "Alert severity" |
* | "any_severity" | "Any severity" |
* | "severity_critical" | "Critical" |
* | "severity_high" | "High" |
* | "severity_warning" | "Warning" |
* | "severity_info" | "Info" |
* | "match_labels" | "Labels" |
* | "labels_hint" | "key=value, separated by commas. A key alone matches any value." |
* | "labels_invalid" | "Write each label as key=value, at most 10." |
* | "action_label" | "Then" |
* | "action_open" | "Open an incident" |
* | "action_group" | "Group into one open incident" |
* | "action_suppress" | "Keep the alert, open no incident" |
* | "action_drop" | "Drop it" |
* | "severity_label" | "Incident severity" |
* | "severity_from_alert" | "The alert's own" |
* | "policy_label" | "Escalation policy" |
* | "policy_default" | "Default policy" |
* | "type_label" | "Incident type" |
* | "type_none" | "No type" |
* | "services_label" | "Services" |
* | "group_by" | "Group by label" |
* | "group_by_hint" | "Alerts with the same value of this label join one open incident." |
* | "group_by_required" | "Name the label to group by." |
* | "add_route" | "Add route" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "save_failed" | "Couldn't save the route. Try again." |
* | "edit" | "Edit" |
* | "move_up" | "Move up" |
* | "move_down" | "Move down" |
* | "route_limit" | "This workspace has as many routes as it can ({value})." |
* | "any_alert" | "Any alert" |
* | "deleted_source" | "a deleted source" |
* | "recent_title" | "Recent alerts" |
* | "recent_empty" | "No alerts received yet." |
* | "status_firing" | "Firing" |
* | "status_resolved" | "Resolved" |
* | "status_closed" | "Closed" |
* | "outcome_opened" | "Opened {name}" |
* | "outcome_grouped" | "Added to {name}" |
* | "outcome_suppressed" | "Suppressed, no incident" |
* | "outcome_dropped" | "Dropped" |
* | "via_route" | "Route: {name}" |
* | "via_default" | "Default route" |
* | "via_malformed" | "Unreadable payload, so the default route took it" |
* | "via_capacity" | "Too many alerts firing, so it paged as the capacity alert" |
* | "route_disabled" | "Off since the account that created it was taken back. Save it to turn it on again." |
* | "source_link" | "Open in the source" |
* | "an_incident" | "an incident" |
* | * | "Alert sources" |
*
* @param {Alerts_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const alerts_card = /** @type {((inputs: Alerts_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Alerts_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Fontes de alertas`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Grafana, Datadog, Sentry ou qualquer ferramenta que envie um webhook manda alertas para um URL secreto. As rotas decidem quais alertas abrem incidentes e quem é acionado.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar as fontes de alertas.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar fonte`);
		if (i?.part === "sources_empty") return /** @type {LocalizedString} */ (`Nenhuma fonte de alertas ainda. Adicione uma para ter um URL para colar na sua ferramenta de monitoramento.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só proprietários e administradores adicionam fontes de alertas e mudam rotas.`);
		if (i?.part === "name_label") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.part === "name_required") return /** @type {LocalizedString} */ (`Dê um nome à fonte.`);
		if (i?.part === "kind_label") return /** @type {LocalizedString} */ (`Enviado por`);
		if (i?.part === "kind_generic") return /** @type {LocalizedString} */ (`Qualquer webhook`);
		if (i?.part === "kind_grafana") return /** @type {LocalizedString} */ (`Grafana`);
		if (i?.part === "kind_datadog") return /** @type {LocalizedString} */ (`Datadog`);
		if (i?.part === "kind_sentry") return /** @type {LocalizedString} */ (`Sentry`);
		if (i?.part === "header_label") return /** @type {LocalizedString} */ (`Cabeçalho extra (opcional)`);
		if (i?.part === "header_hint") return /** @type {LocalizedString} */ (`O Brigade também confere este cabeçalho. Para Basic auth, use Authorization.`);
		if (i?.part === "header_value_label") return /** @type {LocalizedString} */ (`Valor do cabeçalho`);
		if (i?.part === "header_invalid") return /** @type {LocalizedString} */ (`Use letras, dígitos e hífens, e não um cabeçalho do próprio transporte.`);
		if (i?.part === "header_value_required") return /** @type {LocalizedString} */ (`Informe o valor que o cabeçalho leva.`);
		if (i?.part === "secret_label_sentry") return /** @type {LocalizedString} */ (`Client secret`);
		if (i?.part === "secret_hint_sentry") return /** @type {LocalizedString} */ (`Da sua integração interna do Sentry. O Brigade confere a assinatura de cada webhook com ele.`);
		if (i?.part === "secret_label_grafana") return /** @type {LocalizedString} */ (`Segredo HMAC (opcional)`);
		if (i?.part === "secret_hint_grafana") return /** @type {LocalizedString} */ (`Use o mesmo segredo nas configurações de assinatura HMAC do ponto de contato.`);
		if (i?.part === "secret_required") return /** @type {LocalizedString} */ (`O Sentry assina todo webhook: cole o client secret dele.`);
		if (i?.part === "secret_invalid") return /** @type {LocalizedString} */ (`Use de 8 a 256 caracteres, sem espaços.`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Criar fonte`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Criando…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "create_failed") return /** @type {LocalizedString} */ (`Não foi possível criar a fonte. Tente de novo.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Este espaço de trabalho já tem o máximo de fontes de alertas (${i?.value}). Exclua uma para adicionar outra.`);
		if (i?.part === "url_once") return /** @type {LocalizedString} */ (`Copie este URL agora. O Brigade guarda só um hash dele, então ele aparece uma vez só.`);
		if (i?.part === "url_rotated") return /** @type {LocalizedString} */ (`Novo URL para ${i?.name}. O antigo não funciona mais.`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copiar`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copiado`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Fechar sem copiar? Você precisaria de um novo URL.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter aberto`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar`);
		if (i?.part === "setup_title") return /** @type {LocalizedString} */ (`Onde colar`);
		if (i?.part === "setup_grafana") return /** @type {LocalizedString} */ (`No Grafana, abra Alerting e depois Contact points, e adicione uma integração Webhook com este URL e o método POST. Depois aponte uma política de notificação para esse ponto de contato.`);
		if (i?.part === "setup_grafana_hmac") return /** @type {LocalizedString} */ (`Em Optional Webhook settings, configure HMAC Signature com o segredo que você informou ao Brigade. Mantenha o cabeçalho de assinatura padrão e deixe o cabeçalho de timestamp vazio.`);
		if (i?.part === "setup_datadog") return /** @type {LocalizedString} */ (`No Datadog, abra Integrations e depois Webhooks, e adicione um webhook chamado brigade com este URL e o payload abaixo. Depois coloque @webhook-brigade na mensagem de um monitor.`);
		if (i?.part === "setup_sentry") return /** @type {LocalizedString} */ (`No Sentry, abra Settings e depois Developer Settings, e crie uma integração interna com este URL de webhook. Ative Alert Rule Action, copie o client secret para o Brigade e escolha a integração nas ações de uma regra de alerta.`);
		if (i?.part === "setup_generic") return /** @type {LocalizedString} */ (`Faça POST de JSON para este URL. Só title é obrigatório. Envie o mesmo dedup_key enquanto o alerta dispara, e status resolved quando acabar.`);
		if (i?.part === "setup_header") return /** @type {LocalizedString} */ (`Envie também o cabeçalho ${i?.name} com o valor que você informou.`);
		if (i?.part === "setup_show") return /** @type {LocalizedString} */ (`Como conectar`);
		if (i?.part === "last_received") return /** @type {LocalizedString} */ (`Último alerta ${i?.value}`);
		if (i?.part === "never_received") return /** @type {LocalizedString} */ (`Nenhum alerta recebido ainda`);
		if (i?.part === "signed") return /** @type {LocalizedString} */ (`Assinatura conferida`);
		if (i?.part === "header_checked") return /** @type {LocalizedString} */ (`Confere ${i?.name}`);
		if (i?.part === "rotate") return /** @type {LocalizedString} */ (`Novo URL`);
		if (i?.part === "rotate_confirm") return /** @type {LocalizedString} */ (`O URL atual para de funcionar na hora. Atualize o que envia para ele.`);
		if (i?.part === "rotate_failed") return /** @type {LocalizedString} */ (`Não foi possível gerar um novo URL. O atual continua funcionando.`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Excluir`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? O URL para de funcionar e os alertas disparando dela são resolvidos. Os incidentes que eles abriram continuam abertos.`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Não foi possível excluir. Tente de novo.`);
		if (i?.part === "keep_source") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "routes_title") return /** @type {LocalizedString} */ (`Rotas de alertas`);
		if (i?.part === "routes_hint") return /** @type {LocalizedString} */ (`Testadas de cima para baixo: a primeira rota que combina decide. Um alerta sem rota que combine abre um incidente com a própria severidade, acionado pela política padrão.`);
		if (i?.part === "default_route") return /** @type {LocalizedString} */ (`Todo o resto`);
		if (i?.part === "default_route_action") return /** @type {LocalizedString} */ (`Abre um incidente com a severidade do alerta, acionado pela política padrão. Payloads ilegíveis sempre vêm para cá.`);
		if (i?.part === "route_name") return /** @type {LocalizedString} */ (`Nome da rota`);
		if (i?.part === "route_name_required") return /** @type {LocalizedString} */ (`Dê um nome à rota.`);
		if (i?.part === "match_sources") return /** @type {LocalizedString} */ (`De`);
		if (i?.part === "any_source") return /** @type {LocalizedString} */ (`Qualquer fonte`);
		if (i?.part === "match_severities") return /** @type {LocalizedString} */ (`Severidade do alerta`);
		if (i?.part === "any_severity") return /** @type {LocalizedString} */ (`Qualquer severidade`);
		if (i?.part === "severity_critical") return /** @type {LocalizedString} */ (`Crítica`);
		if (i?.part === "severity_high") return /** @type {LocalizedString} */ (`Alta`);
		if (i?.part === "severity_warning") return /** @type {LocalizedString} */ (`Aviso`);
		if (i?.part === "severity_info") return /** @type {LocalizedString} */ (`Informativa`);
		if (i?.part === "match_labels") return /** @type {LocalizedString} */ (`Rótulos`);
		if (i?.part === "labels_hint") return /** @type {LocalizedString} */ (`chave=valor, separados por vírgula. Uma chave sozinha combina com qualquer valor.`);
		if (i?.part === "labels_invalid") return /** @type {LocalizedString} */ (`Escreva cada rótulo como chave=valor, no máximo 10.`);
		if (i?.part === "action_label") return /** @type {LocalizedString} */ (`Então`);
		if (i?.part === "action_open") return /** @type {LocalizedString} */ (`Abrir um incidente`);
		if (i?.part === "action_group") return /** @type {LocalizedString} */ (`Agrupar num incidente aberto`);
		if (i?.part === "action_suppress") return /** @type {LocalizedString} */ (`Guardar o alerta, sem incidente`);
		if (i?.part === "action_drop") return /** @type {LocalizedString} */ (`Descartar`);
		if (i?.part === "severity_label") return /** @type {LocalizedString} */ (`Severidade do incidente`);
		if (i?.part === "severity_from_alert") return /** @type {LocalizedString} */ (`A do próprio alerta`);
		if (i?.part === "policy_label") return /** @type {LocalizedString} */ (`Política de escalonamento`);
		if (i?.part === "policy_default") return /** @type {LocalizedString} */ (`Política padrão`);
		if (i?.part === "type_label") return /** @type {LocalizedString} */ (`Tipo de incidente`);
		if (i?.part === "type_none") return /** @type {LocalizedString} */ (`Sem tipo`);
		if (i?.part === "services_label") return /** @type {LocalizedString} */ (`Serviços`);
		if (i?.part === "group_by") return /** @type {LocalizedString} */ (`Agrupar pelo rótulo`);
		if (i?.part === "group_by_hint") return /** @type {LocalizedString} */ (`Alertas com o mesmo valor deste rótulo entram num mesmo incidente aberto.`);
		if (i?.part === "group_by_required") return /** @type {LocalizedString} */ (`Informe o rótulo para agrupar.`);
		if (i?.part === "add_route") return /** @type {LocalizedString} */ (`Adicionar rota`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar a rota. Tente de novo.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "move_up") return /** @type {LocalizedString} */ (`Subir`);
		if (i?.part === "move_down") return /** @type {LocalizedString} */ (`Descer`);
		if (i?.part === "route_limit") return /** @type {LocalizedString} */ (`Este espaço de trabalho já tem o máximo de rotas (${i?.value}).`);
		if (i?.part === "any_alert") return /** @type {LocalizedString} */ (`Qualquer alerta`);
		if (i?.part === "deleted_source") return /** @type {LocalizedString} */ (`uma fonte excluída`);
		if (i?.part === "recent_title") return /** @type {LocalizedString} */ (`Alertas recentes`);
		if (i?.part === "recent_empty") return /** @type {LocalizedString} */ (`Nenhum alerta recebido ainda.`);
		if (i?.part === "status_firing") return /** @type {LocalizedString} */ (`Disparando`);
		if (i?.part === "status_resolved") return /** @type {LocalizedString} */ (`Resolvido`);
		if (i?.part === "status_closed") return /** @type {LocalizedString} */ (`Encerrado`);
		if (i?.part === "outcome_opened") return /** @type {LocalizedString} */ (`Abriu ${i?.name}`);
		if (i?.part === "outcome_grouped") return /** @type {LocalizedString} */ (`Adicionado a ${i?.name}`);
		if (i?.part === "outcome_suppressed") return /** @type {LocalizedString} */ (`Suprimido, sem incidente`);
		if (i?.part === "outcome_dropped") return /** @type {LocalizedString} */ (`Descartado`);
		if (i?.part === "via_route") return /** @type {LocalizedString} */ (`Rota: ${i?.name}`);
		if (i?.part === "via_default") return /** @type {LocalizedString} */ (`Rota padrão`);
		if (i?.part === "via_malformed") return /** @type {LocalizedString} */ (`Payload ilegível, então a rota padrão assumiu`);
		if (i?.part === "via_capacity") return /** @type {LocalizedString} */ (`Alertas demais disparando, então acionou como o alerta de capacidade`);
		if (i?.part === "route_disabled") return /** @type {LocalizedString} */ (`Desligada desde que a conta que a criou foi recuperada. Salve para ligá-la de novo.`);
		if (i?.part === "source_link") return /** @type {LocalizedString} */ (`Abrir na origem`);
		if (i?.part === "an_incident") return /** @type {LocalizedString} */ (`um incidente`);
		return /** @type {LocalizedString} */ (`Fontes de alertas`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Alert sources`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Grafana, Datadog, Sentry or anything that sends a webhook posts alerts to a secret URL. Routes decide which alerts open incidents and who is paged.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load alert sources.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add source`);
		if (i?.part === "sources_empty") return /** @type {LocalizedString} */ (`No alert sources yet. Add one to get a URL to paste into your monitoring tool.`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins add alert sources and change routes.`);
		if (i?.part === "name_label") return /** @type {LocalizedString} */ (`Name`);
		if (i?.part === "name_required") return /** @type {LocalizedString} */ (`Give the source a name.`);
		if (i?.part === "kind_label") return /** @type {LocalizedString} */ (`Sent by`);
		if (i?.part === "kind_generic") return /** @type {LocalizedString} */ (`Any webhook`);
		if (i?.part === "kind_grafana") return /** @type {LocalizedString} */ (`Grafana`);
		if (i?.part === "kind_datadog") return /** @type {LocalizedString} */ (`Datadog`);
		if (i?.part === "kind_sentry") return /** @type {LocalizedString} */ (`Sentry`);
		if (i?.part === "header_label") return /** @type {LocalizedString} */ (`Extra header (optional)`);
		if (i?.part === "header_hint") return /** @type {LocalizedString} */ (`Brigade also checks this header. For Basic auth, use Authorization.`);
		if (i?.part === "header_value_label") return /** @type {LocalizedString} */ (`Header value`);
		if (i?.part === "header_invalid") return /** @type {LocalizedString} */ (`Use letters, digits and hyphens, and not a header the transport uses.`);
		if (i?.part === "header_value_required") return /** @type {LocalizedString} */ (`Enter the value the header carries.`);
		if (i?.part === "secret_label_sentry") return /** @type {LocalizedString} */ (`Client secret`);
		if (i?.part === "secret_hint_sentry") return /** @type {LocalizedString} */ (`From your Sentry internal integration. Brigade checks every webhook's signature with it.`);
		if (i?.part === "secret_label_grafana") return /** @type {LocalizedString} */ (`HMAC secret (optional)`);
		if (i?.part === "secret_hint_grafana") return /** @type {LocalizedString} */ (`Set the same secret in the contact point's HMAC signature settings.`);
		if (i?.part === "secret_required") return /** @type {LocalizedString} */ (`Sentry signs every webhook: paste its client secret.`);
		if (i?.part === "secret_invalid") return /** @type {LocalizedString} */ (`Use 8 to 256 characters, without spaces.`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Create source`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Creating…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "create_failed") return /** @type {LocalizedString} */ (`Couldn't create the source. Try again.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`This workspace has as many alert sources as it can (${i?.value}). Delete one to add another.`);
		if (i?.part === "url_once") return /** @type {LocalizedString} */ (`Copy this URL now. Brigade keeps only a hash of it, so it is shown once.`);
		if (i?.part === "url_rotated") return /** @type {LocalizedString} */ (`New URL for ${i?.name}. The old one no longer works.`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copy`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copied`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Close without copying? You'd need a new URL.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep it open`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close`);
		if (i?.part === "setup_title") return /** @type {LocalizedString} */ (`Where to paste it`);
		if (i?.part === "setup_grafana") return /** @type {LocalizedString} */ (`In Grafana, open Alerting, then Contact points, and add a Webhook integration with this URL and the POST method. Then send a notification policy to that contact point.`);
		if (i?.part === "setup_grafana_hmac") return /** @type {LocalizedString} */ (`Under Optional Webhook settings, set HMAC Signature to the secret you gave Brigade. Keep the default signature header and leave the timestamp header empty.`);
		if (i?.part === "setup_datadog") return /** @type {LocalizedString} */ (`In Datadog, open Integrations, then Webhooks, and add a webhook named brigade with this URL and the payload below. Then add @webhook-brigade to a monitor's message.`);
		if (i?.part === "setup_sentry") return /** @type {LocalizedString} */ (`In Sentry, open Settings, then Developer Settings, and create an internal integration with this webhook URL. Turn on Alert Rule Action, copy its client secret into Brigade, and pick the integration in an alert rule's actions.`);
		if (i?.part === "setup_generic") return /** @type {LocalizedString} */ (`POST JSON to this URL. Only title is required. Send the same dedup_key while the alert fires, and status resolved when it's over.`);
		if (i?.part === "setup_header") return /** @type {LocalizedString} */ (`Also send the header ${i?.name} with the value you entered.`);
		if (i?.part === "setup_show") return /** @type {LocalizedString} */ (`How to connect it`);
		if (i?.part === "last_received") return /** @type {LocalizedString} */ (`Last alert ${i?.value}`);
		if (i?.part === "never_received") return /** @type {LocalizedString} */ (`No alert received yet`);
		if (i?.part === "signed") return /** @type {LocalizedString} */ (`Signature checked`);
		if (i?.part === "header_checked") return /** @type {LocalizedString} */ (`Checks ${i?.name}`);
		if (i?.part === "rotate") return /** @type {LocalizedString} */ (`New URL`);
		if (i?.part === "rotate_confirm") return /** @type {LocalizedString} */ (`The current URL stops working at once. Update whatever sends to it.`);
		if (i?.part === "rotate_failed") return /** @type {LocalizedString} */ (`Couldn't make a new URL. The current one still works.`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Delete`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Its URL stops working and its firing alerts resolve. Incidents they opened stay open.`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Couldn't delete it. Try again.`);
		if (i?.part === "keep_source") return /** @type {LocalizedString} */ (`Keep it`);
		if (i?.part === "routes_title") return /** @type {LocalizedString} */ (`Alert routes`);
		if (i?.part === "routes_hint") return /** @type {LocalizedString} */ (`Tried from the top: the first route that matches decides. An alert no route matches opens an incident at its own severity, paged through the default policy.`);
		if (i?.part === "default_route") return /** @type {LocalizedString} */ (`Everything else`);
		if (i?.part === "default_route_action") return /** @type {LocalizedString} */ (`Opens an incident at the alert's severity, paged through the default policy. Unreadable payloads always come here.`);
		if (i?.part === "route_name") return /** @type {LocalizedString} */ (`Route name`);
		if (i?.part === "route_name_required") return /** @type {LocalizedString} */ (`Give the route a name.`);
		if (i?.part === "match_sources") return /** @type {LocalizedString} */ (`From`);
		if (i?.part === "any_source") return /** @type {LocalizedString} */ (`Any source`);
		if (i?.part === "match_severities") return /** @type {LocalizedString} */ (`Alert severity`);
		if (i?.part === "any_severity") return /** @type {LocalizedString} */ (`Any severity`);
		if (i?.part === "severity_critical") return /** @type {LocalizedString} */ (`Critical`);
		if (i?.part === "severity_high") return /** @type {LocalizedString} */ (`High`);
		if (i?.part === "severity_warning") return /** @type {LocalizedString} */ (`Warning`);
		if (i?.part === "severity_info") return /** @type {LocalizedString} */ (`Info`);
		if (i?.part === "match_labels") return /** @type {LocalizedString} */ (`Labels`);
		if (i?.part === "labels_hint") return /** @type {LocalizedString} */ (`key=value, separated by commas. A key alone matches any value.`);
		if (i?.part === "labels_invalid") return /** @type {LocalizedString} */ (`Write each label as key=value, at most 10.`);
		if (i?.part === "action_label") return /** @type {LocalizedString} */ (`Then`);
		if (i?.part === "action_open") return /** @type {LocalizedString} */ (`Open an incident`);
		if (i?.part === "action_group") return /** @type {LocalizedString} */ (`Group into one open incident`);
		if (i?.part === "action_suppress") return /** @type {LocalizedString} */ (`Keep the alert, open no incident`);
		if (i?.part === "action_drop") return /** @type {LocalizedString} */ (`Drop it`);
		if (i?.part === "severity_label") return /** @type {LocalizedString} */ (`Incident severity`);
		if (i?.part === "severity_from_alert") return /** @type {LocalizedString} */ (`The alert's own`);
		if (i?.part === "policy_label") return /** @type {LocalizedString} */ (`Escalation policy`);
		if (i?.part === "policy_default") return /** @type {LocalizedString} */ (`Default policy`);
		if (i?.part === "type_label") return /** @type {LocalizedString} */ (`Incident type`);
		if (i?.part === "type_none") return /** @type {LocalizedString} */ (`No type`);
		if (i?.part === "services_label") return /** @type {LocalizedString} */ (`Services`);
		if (i?.part === "group_by") return /** @type {LocalizedString} */ (`Group by label`);
		if (i?.part === "group_by_hint") return /** @type {LocalizedString} */ (`Alerts with the same value of this label join one open incident.`);
		if (i?.part === "group_by_required") return /** @type {LocalizedString} */ (`Name the label to group by.`);
		if (i?.part === "add_route") return /** @type {LocalizedString} */ (`Add route`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Couldn't save the route. Try again.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "move_up") return /** @type {LocalizedString} */ (`Move up`);
		if (i?.part === "move_down") return /** @type {LocalizedString} */ (`Move down`);
		if (i?.part === "route_limit") return /** @type {LocalizedString} */ (`This workspace has as many routes as it can (${i?.value}).`);
		if (i?.part === "any_alert") return /** @type {LocalizedString} */ (`Any alert`);
		if (i?.part === "deleted_source") return /** @type {LocalizedString} */ (`a deleted source`);
		if (i?.part === "recent_title") return /** @type {LocalizedString} */ (`Recent alerts`);
		if (i?.part === "recent_empty") return /** @type {LocalizedString} */ (`No alerts received yet.`);
		if (i?.part === "status_firing") return /** @type {LocalizedString} */ (`Firing`);
		if (i?.part === "status_resolved") return /** @type {LocalizedString} */ (`Resolved`);
		if (i?.part === "status_closed") return /** @type {LocalizedString} */ (`Closed`);
		if (i?.part === "outcome_opened") return /** @type {LocalizedString} */ (`Opened ${i?.name}`);
		if (i?.part === "outcome_grouped") return /** @type {LocalizedString} */ (`Added to ${i?.name}`);
		if (i?.part === "outcome_suppressed") return /** @type {LocalizedString} */ (`Suppressed, no incident`);
		if (i?.part === "outcome_dropped") return /** @type {LocalizedString} */ (`Dropped`);
		if (i?.part === "via_route") return /** @type {LocalizedString} */ (`Route: ${i?.name}`);
		if (i?.part === "via_default") return /** @type {LocalizedString} */ (`Default route`);
		if (i?.part === "via_malformed") return /** @type {LocalizedString} */ (`Unreadable payload, so the default route took it`);
		if (i?.part === "via_capacity") return /** @type {LocalizedString} */ (`Too many alerts firing, so it paged as the capacity alert`);
		if (i?.part === "route_disabled") return /** @type {LocalizedString} */ (`Off since the account that created it was taken back. Save it to turn it on again.`);
		if (i?.part === "source_link") return /** @type {LocalizedString} */ (`Open in the source`);
		if (i?.part === "an_incident") return /** @type {LocalizedString} */ (`an incident`);
		return /** @type {LocalizedString} */ (`Alert sources`)
	}
});