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
* | "pages_taken" | "This phone still pages the last person signed in on it. They need to sign out on it first." |
* | "open_hint" | "Opens the incident" |
* | "assign_hint" | "Opens the members who can hold it" |
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
		if (i?.part === "pages_taken") return /** @type {LocalizedString} */ (`Este telefone ainda chama a última pessoa que entrou nele. Ela precisa sair nele primeiro.`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Abre o incidente`);
		if (i?.part === "assign_hint") return /** @type {LocalizedString} */ (`Abre os membros que podem assumir`);
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
		if (i?.part === "pages_taken") return /** @type {LocalizedString} */ (`This phone still pages the last person signed in on it. They need to sign out on it first.`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Opens the incident`);
		if (i?.part === "assign_hint") return /** @type {LocalizedString} */ (`Opens the members who can hold it`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});