/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, when: NonNullable<unknown> }} Api_Tokens_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "API tokens" |
* | "description" | "Let scripts and integrations call Brigade's API for this workspace. A token acts with your role, never beyond the scopes you give it." |
* | "add" | "Create token" |
* | "manage_only" | "Only owners and admins can create and revoke API tokens." |
* | "empty" | "No tokens yet. Create one for a script, a CI job or an integration." |
* | "load_failed" | "Couldn't load the API tokens." |
* | "retry" | "Try again" |
* | "name_label" | "Name" |
* | "name_hint" | "What uses it, so you know what breaks when you revoke it." |
* | "name_invalid" | "Give it a name of up to 60 characters." |
* | "scopes_label" | "Scopes" |
* | "scopes_none" | "Pick at least one scope." |
* | "members_note" | "A token never makes anyone an owner or admin, never changes or removes an owner or admin, and never changes its creator." |
* | "expiry_label" | "Expires" |
* | "expiry_30" | "In 30 days" |
* | "expiry_90" | "In 90 days" |
* | "expiry_365" | "In a year" |
* | "expiry_never" | "Never" |
* | "create_go" | "Create token" |
* | "creating" | "Creating…" |
* | "cancel" | "Cancel" |
* | "create_failed" | "Couldn't create the token. Try again." |
* | "forbidden" | "Your role can't grant one of those scopes." |
* | "limit" | "This workspace has 50 active tokens. Revoke one to create another." |
* | "token_created" | "Token {name} created" |
* | "token_once" | "Copy it now: Brigade keeps only a hash and won't show it again. Send it as Authorization: Bearer." |
* | "token_label" | "API token" |
* | "copy" | "Copy" |
* | "copied" | "Copied" |
* | "copy_key" | "Copy didn't work. The token is selected: press Ctrl+C." |
* | "copy_key_apple" | "Copy didn't work. The token is selected: press ⌘C." |
* | "close_prompt" | "Close without copying? You won't see this token again." |
* | "keep_open" | "Keep it open" |
* | "close" | "Close" |
* | "by" | "By {name}" |
* | "used_never" | "Never used" |
* | "used" | "Used {when}" |
* | "expires" | "Expires {when}" |
* | "expires_never" | "Doesn't expire" |
* | "state_active" | "Active" |
* | "state_revoked" | "Revoked" |
* | "state_expired" | "Expired" |
* | "state_disabled" | "Disabled: its creator left" |
* | "revoke" | "Revoke" |
* | "revoke_confirm" | "Revoke {name}? Anything using it stops working right away." |
* | "revoke_go" | "Revoke token" |
* | "revoking" | "Revoking…" |
* | "revoke_failed" | "Couldn't revoke the token. Try again." |
* | "keep" | "Keep it" |
* | "group_incident" | "Incidents" |
* | "group_workspace" | "Workspace" |
* | "group_members" | "Members" |
* | "group_monitor" | "Monitors" |
* | "group_schedule" | "On-call" |
* | "group_escalation" | "Escalation" |
* | "group_status" | "Status page" |
* | "group_webhook" | "Webhooks" |
* | "group_catalog" | "Catalog" |
* | "group_data" | "Data" |
* | "group_alert" | "Alerts" |
* | * | "API tokens" |
*
* @param {Api_Tokens_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const api_tokens_card = /** @type {((inputs: Api_Tokens_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Tokens_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Tokens de API`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Permita que scripts e integrações chamem a API do Brigade neste workspace. Um token age com o seu papel, nunca além dos escopos que você der a ele.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Criar token`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só donos e admins podem criar e revogar tokens de API.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhum token ainda. Crie um para um script, um job de CI ou uma integração.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar os tokens de API.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "name_label") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.part === "name_hint") return /** @type {LocalizedString} */ (`O que usa o token, para você saber o que para quando revogá-lo.`);
		if (i?.part === "name_invalid") return /** @type {LocalizedString} */ (`Dê a ele um nome de até 60 caracteres.`);
		if (i?.part === "scopes_label") return /** @type {LocalizedString} */ (`Escopos`);
		if (i?.part === "scopes_none") return /** @type {LocalizedString} */ (`Escolha pelo menos um escopo.`);
		if (i?.part === "members_note") return /** @type {LocalizedString} */ (`Um token nunca torna alguém dono ou admin, nunca altera nem remove um dono ou admin, e nunca altera quem o criou.`);
		if (i?.part === "expiry_label") return /** @type {LocalizedString} */ (`Expira`);
		if (i?.part === "expiry_30") return /** @type {LocalizedString} */ (`Em 30 dias`);
		if (i?.part === "expiry_90") return /** @type {LocalizedString} */ (`Em 90 dias`);
		if (i?.part === "expiry_365") return /** @type {LocalizedString} */ (`Em um ano`);
		if (i?.part === "expiry_never") return /** @type {LocalizedString} */ (`Nunca`);
		if (i?.part === "create_go") return /** @type {LocalizedString} */ (`Criar token`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Criando…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "create_failed") return /** @type {LocalizedString} */ (`Não foi possível criar o token. Tente de novo.`);
		if (i?.part === "forbidden") return /** @type {LocalizedString} */ (`O seu papel não pode conceder um desses escopos.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Este workspace tem 50 tokens ativos. Revogue um para criar outro.`);
		if (i?.part === "token_created") return /** @type {LocalizedString} */ (`Token ${i?.name} criado`);
		if (i?.part === "token_once") return /** @type {LocalizedString} */ (`Copie agora: o Brigade guarda só um hash e não vai mostrá-lo de novo. Envie como Authorization: Bearer.`);
		if (i?.part === "token_label") return /** @type {LocalizedString} */ (`Token de API`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copiar`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copiado`);
		if (i?.part === "copy_key") return /** @type {LocalizedString} */ (`Não deu para copiar. O token está selecionado: aperte Ctrl+C.`);
		if (i?.part === "copy_key_apple") return /** @type {LocalizedString} */ (`Não deu para copiar. O token está selecionado: aperte ⌘C.`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Fechar sem copiar? Você não verá este token de novo.`);
		if (i?.part === "keep_open") return /** @type {LocalizedString} */ (`Manter aberto`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar`);
		if (i?.part === "by") return /** @type {LocalizedString} */ (`Por ${i?.name}`);
		if (i?.part === "used_never") return /** @type {LocalizedString} */ (`Nunca usado`);
		if (i?.part === "used") return /** @type {LocalizedString} */ (`Usado ${i?.when}`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expira ${i?.when}`);
		if (i?.part === "expires_never") return /** @type {LocalizedString} */ (`Não expira`);
		if (i?.part === "state_active") return /** @type {LocalizedString} */ (`Ativo`);
		if (i?.part === "state_revoked") return /** @type {LocalizedString} */ (`Revogado`);
		if (i?.part === "state_expired") return /** @type {LocalizedString} */ (`Expirado`);
		if (i?.part === "state_disabled") return /** @type {LocalizedString} */ (`Desativado: quem o criou saiu`);
		if (i?.part === "revoke") return /** @type {LocalizedString} */ (`Revogar`);
		if (i?.part === "revoke_confirm") return /** @type {LocalizedString} */ (`Revogar ${i?.name}? O que o usa para de funcionar na hora.`);
		if (i?.part === "revoke_go") return /** @type {LocalizedString} */ (`Revogar token`);
		if (i?.part === "revoking") return /** @type {LocalizedString} */ (`Revogando…`);
		if (i?.part === "revoke_failed") return /** @type {LocalizedString} */ (`Não foi possível revogar o token. Tente de novo.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "group_incident") return /** @type {LocalizedString} */ (`Incidentes`);
		if (i?.part === "group_workspace") return /** @type {LocalizedString} */ (`Workspace`);
		if (i?.part === "group_members") return /** @type {LocalizedString} */ (`Membros`);
		if (i?.part === "group_monitor") return /** @type {LocalizedString} */ (`Monitores`);
		if (i?.part === "group_schedule") return /** @type {LocalizedString} */ (`Plantão`);
		if (i?.part === "group_escalation") return /** @type {LocalizedString} */ (`Escalonamento`);
		if (i?.part === "group_status") return /** @type {LocalizedString} */ (`Página de status`);
		if (i?.part === "group_webhook") return /** @type {LocalizedString} */ (`Webhooks`);
		if (i?.part === "group_catalog") return /** @type {LocalizedString} */ (`Catálogo`);
		if (i?.part === "group_data") return /** @type {LocalizedString} */ (`Dados`);
		if (i?.part === "group_alert") return /** @type {LocalizedString} */ (`Alertas`);
		return /** @type {LocalizedString} */ (`Tokens de API`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`API tokens`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Let scripts and integrations call Brigade's API for this workspace. A token acts with your role, never beyond the scopes you give it.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Create token`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins can create and revoke API tokens.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No tokens yet. Create one for a script, a CI job or an integration.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the API tokens.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "name_label") return /** @type {LocalizedString} */ (`Name`);
		if (i?.part === "name_hint") return /** @type {LocalizedString} */ (`What uses it, so you know what breaks when you revoke it.`);
		if (i?.part === "name_invalid") return /** @type {LocalizedString} */ (`Give it a name of up to 60 characters.`);
		if (i?.part === "scopes_label") return /** @type {LocalizedString} */ (`Scopes`);
		if (i?.part === "scopes_none") return /** @type {LocalizedString} */ (`Pick at least one scope.`);
		if (i?.part === "members_note") return /** @type {LocalizedString} */ (`A token never makes anyone an owner or admin, never changes or removes an owner or admin, and never changes its creator.`);
		if (i?.part === "expiry_label") return /** @type {LocalizedString} */ (`Expires`);
		if (i?.part === "expiry_30") return /** @type {LocalizedString} */ (`In 30 days`);
		if (i?.part === "expiry_90") return /** @type {LocalizedString} */ (`In 90 days`);
		if (i?.part === "expiry_365") return /** @type {LocalizedString} */ (`In a year`);
		if (i?.part === "expiry_never") return /** @type {LocalizedString} */ (`Never`);
		if (i?.part === "create_go") return /** @type {LocalizedString} */ (`Create token`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Creating…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "create_failed") return /** @type {LocalizedString} */ (`Couldn't create the token. Try again.`);
		if (i?.part === "forbidden") return /** @type {LocalizedString} */ (`Your role can't grant one of those scopes.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`This workspace has 50 active tokens. Revoke one to create another.`);
		if (i?.part === "token_created") return /** @type {LocalizedString} */ (`Token ${i?.name} created`);
		if (i?.part === "token_once") return /** @type {LocalizedString} */ (`Copy it now: Brigade keeps only a hash and won't show it again. Send it as Authorization: Bearer.`);
		if (i?.part === "token_label") return /** @type {LocalizedString} */ (`API token`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copy`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copied`);
		if (i?.part === "copy_key") return /** @type {LocalizedString} */ (`Copy didn't work. The token is selected: press Ctrl+C.`);
		if (i?.part === "copy_key_apple") return /** @type {LocalizedString} */ (`Copy didn't work. The token is selected: press ⌘C.`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Close without copying? You won't see this token again.`);
		if (i?.part === "keep_open") return /** @type {LocalizedString} */ (`Keep it open`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close`);
		if (i?.part === "by") return /** @type {LocalizedString} */ (`By ${i?.name}`);
		if (i?.part === "used_never") return /** @type {LocalizedString} */ (`Never used`);
		if (i?.part === "used") return /** @type {LocalizedString} */ (`Used ${i?.when}`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expires ${i?.when}`);
		if (i?.part === "expires_never") return /** @type {LocalizedString} */ (`Doesn't expire`);
		if (i?.part === "state_active") return /** @type {LocalizedString} */ (`Active`);
		if (i?.part === "state_revoked") return /** @type {LocalizedString} */ (`Revoked`);
		if (i?.part === "state_expired") return /** @type {LocalizedString} */ (`Expired`);
		if (i?.part === "state_disabled") return /** @type {LocalizedString} */ (`Disabled: its creator left`);
		if (i?.part === "revoke") return /** @type {LocalizedString} */ (`Revoke`);
		if (i?.part === "revoke_confirm") return /** @type {LocalizedString} */ (`Revoke ${i?.name}? Anything using it stops working right away.`);
		if (i?.part === "revoke_go") return /** @type {LocalizedString} */ (`Revoke token`);
		if (i?.part === "revoking") return /** @type {LocalizedString} */ (`Revoking…`);
		if (i?.part === "revoke_failed") return /** @type {LocalizedString} */ (`Couldn't revoke the token. Try again.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep it`);
		if (i?.part === "group_incident") return /** @type {LocalizedString} */ (`Incidents`);
		if (i?.part === "group_workspace") return /** @type {LocalizedString} */ (`Workspace`);
		if (i?.part === "group_members") return /** @type {LocalizedString} */ (`Members`);
		if (i?.part === "group_monitor") return /** @type {LocalizedString} */ (`Monitors`);
		if (i?.part === "group_schedule") return /** @type {LocalizedString} */ (`On-call`);
		if (i?.part === "group_escalation") return /** @type {LocalizedString} */ (`Escalation`);
		if (i?.part === "group_status") return /** @type {LocalizedString} */ (`Status page`);
		if (i?.part === "group_webhook") return /** @type {LocalizedString} */ (`Webhooks`);
		if (i?.part === "group_catalog") return /** @type {LocalizedString} */ (`Catalog`);
		if (i?.part === "group_data") return /** @type {LocalizedString} */ (`Data`);
		if (i?.part === "group_alert") return /** @type {LocalizedString} */ (`Alerts`);
		return /** @type {LocalizedString} */ (`API tokens`)
	}
});