/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Mobile_SessionInputs */



/**
* | part | output |
* | --- | --- |
* | "sign_in_hint" | "New to Brigade? Create an account on the dashboard, then sign in here." |
* | "no_server" | "This build doesn't say which Brigade to connect to." |
* | "account" | "Account" |
* | "no_workspace" | "Your account isn't in a workspace yet. Create one on the dashboard, then open Brigade again." |
* | "sign_out_title" | "Sign out of Brigade?" |
* | "sign_out_body" | "This phone stops getting pages until you sign in again." |
* | "cancel" | "Cancel" |
* | "signing_out" | "Signing out…" |
* | "pages" | "Pages on this phone" |
* | "pages_pending" | "Setting up…" |
* | "pages_on" | "On" |
* | "pages_off" | "Notifications are off. Turn them on in Settings to be paged here." |
* | "pages_unsupported" | "Not on this phone yet" |
* | "pages_failed" | "Couldn't register this phone. Brigade tries again the next time it opens." |
* | "pages_taken" | "This phone still pages the person signed in on it before you, who signed out without a connection. Brigade frees it for you once it can finish their sign-out." |
* | "open_hint" | "Opens the incident" |
* | "assign_hint" | "Opens the members who can hold it" |
* | "pages_notice_title" | "This phone isn't paging you" |
* | "open_settings" | "Open Settings" |
* | "sign_out_body_unpaged" | "You'll need to sign in again to see incidents here." |
* | "sign_out_kept_title" | "This phone may still get pages for you" |
* | "sign_out_kept_body" | "Brigade couldn't reach the server, so this phone keeps getting your pages until it's back online. Brigade finishes signing you out then, on its own." |
* | "update_sending" | "Sending…" |
* | "update_waiting" | "Waiting for a connection" |
* | "show_password" | "Show password" |
* | "hide_password" | "Hide password" |
* | * | "Brigade" |
*
* @param {Mobile_SessionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_session = /** @type {((inputs: Mobile_SessionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_SessionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "sign_in_hint") return /** @type {LocalizedString} */ (`Novo no Brigade? Crie uma conta no painel e depois entre aqui.`);
		if (i?.part === "no_server") return /** @type {LocalizedString} */ (`Este build não diz a qual Brigade se conectar.`);
		if (i?.part === "account") return /** @type {LocalizedString} */ (`Conta`);
		if (i?.part === "no_workspace") return /** @type {LocalizedString} */ (`Sua conta ainda não está em um espaço de trabalho. Crie um no painel e abra o Brigade de novo.`);
		if (i?.part === "sign_out_title") return /** @type {LocalizedString} */ (`Sair do Brigade?`);
		if (i?.part === "sign_out_body") return /** @type {LocalizedString} */ (`Este telefone deixa de receber chamados até você entrar de novo.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "signing_out") return /** @type {LocalizedString} */ (`Saindo…`);
		if (i?.part === "pages") return /** @type {LocalizedString} */ (`Chamados neste telefone`);
		if (i?.part === "pages_pending") return /** @type {LocalizedString} */ (`Configurando…`);
		if (i?.part === "pages_on") return /** @type {LocalizedString} */ (`Ativados`);
		if (i?.part === "pages_off") return /** @type {LocalizedString} */ (`As notificações estão desativadas. Ative-as nos Ajustes para receber chamados aqui.`);
		if (i?.part === "pages_unsupported") return /** @type {LocalizedString} */ (`Ainda não neste telefone`);
		if (i?.part === "pages_failed") return /** @type {LocalizedString} */ (`Não foi possível registrar este telefone. O Brigade tenta de novo na próxima vez que abrir.`);
		if (i?.part === "pages_taken") return /** @type {LocalizedString} */ (`Este telefone ainda chama a pessoa que entrou nele antes de você e saiu sem conexão. O Brigade libera o telefone para você assim que conseguir concluir a saída dela.`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Abre o incidente`);
		if (i?.part === "assign_hint") return /** @type {LocalizedString} */ (`Abre os membros que podem assumir`);
		if (i?.part === "pages_notice_title") return /** @type {LocalizedString} */ (`Este telefone não está chamando você`);
		if (i?.part === "open_settings") return /** @type {LocalizedString} */ (`Abrir Ajustes`);
		if (i?.part === "sign_out_body_unpaged") return /** @type {LocalizedString} */ (`Você vai precisar entrar de novo para ver os incidentes aqui.`);
		if (i?.part === "sign_out_kept_title") return /** @type {LocalizedString} */ (`Este telefone ainda pode receber seus chamados`);
		if (i?.part === "sign_out_kept_body") return /** @type {LocalizedString} */ (`O Brigade não conseguiu falar com o servidor, então este telefone continua recebendo seus chamados até voltar a ficar online. Aí o Brigade conclui sua saída sozinho.`);
		if (i?.part === "update_sending") return /** @type {LocalizedString} */ (`Enviando…`);
		if (i?.part === "update_waiting") return /** @type {LocalizedString} */ (`Aguardando conexão`);
		if (i?.part === "show_password") return /** @type {LocalizedString} */ (`Mostrar senha`);
		if (i?.part === "hide_password") return /** @type {LocalizedString} */ (`Ocultar senha`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "sign_in_hint") return /** @type {LocalizedString} */ (`New to Brigade? Create an account on the dashboard, then sign in here.`);
		if (i?.part === "no_server") return /** @type {LocalizedString} */ (`This build doesn't say which Brigade to connect to.`);
		if (i?.part === "account") return /** @type {LocalizedString} */ (`Account`);
		if (i?.part === "no_workspace") return /** @type {LocalizedString} */ (`Your account isn't in a workspace yet. Create one on the dashboard, then open Brigade again.`);
		if (i?.part === "sign_out_title") return /** @type {LocalizedString} */ (`Sign out of Brigade?`);
		if (i?.part === "sign_out_body") return /** @type {LocalizedString} */ (`This phone stops getting pages until you sign in again.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "signing_out") return /** @type {LocalizedString} */ (`Signing out…`);
		if (i?.part === "pages") return /** @type {LocalizedString} */ (`Pages on this phone`);
		if (i?.part === "pages_pending") return /** @type {LocalizedString} */ (`Setting up…`);
		if (i?.part === "pages_on") return /** @type {LocalizedString} */ (`On`);
		if (i?.part === "pages_off") return /** @type {LocalizedString} */ (`Notifications are off. Turn them on in Settings to be paged here.`);
		if (i?.part === "pages_unsupported") return /** @type {LocalizedString} */ (`Not on this phone yet`);
		if (i?.part === "pages_failed") return /** @type {LocalizedString} */ (`Couldn't register this phone. Brigade tries again the next time it opens.`);
		if (i?.part === "pages_taken") return /** @type {LocalizedString} */ (`This phone still pages the person signed in on it before you, who signed out without a connection. Brigade frees it for you once it can finish their sign-out.`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Opens the incident`);
		if (i?.part === "assign_hint") return /** @type {LocalizedString} */ (`Opens the members who can hold it`);
		if (i?.part === "pages_notice_title") return /** @type {LocalizedString} */ (`This phone isn't paging you`);
		if (i?.part === "open_settings") return /** @type {LocalizedString} */ (`Open Settings`);
		if (i?.part === "sign_out_body_unpaged") return /** @type {LocalizedString} */ (`You'll need to sign in again to see incidents here.`);
		if (i?.part === "sign_out_kept_title") return /** @type {LocalizedString} */ (`This phone may still get pages for you`);
		if (i?.part === "sign_out_kept_body") return /** @type {LocalizedString} */ (`Brigade couldn't reach the server, so this phone keeps getting your pages until it's back online. Brigade finishes signing you out then, on its own.`);
		if (i?.part === "update_sending") return /** @type {LocalizedString} */ (`Sending…`);
		if (i?.part === "update_waiting") return /** @type {LocalizedString} */ (`Waiting for a connection`);
		if (i?.part === "show_password") return /** @type {LocalizedString} */ (`Show password`);
		if (i?.part === "hide_password") return /** @type {LocalizedString} */ (`Hide password`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});