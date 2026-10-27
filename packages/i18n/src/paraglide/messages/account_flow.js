/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Account_FlowInputs */



/**
* | part | output |
* | --- | --- |
* | "sign_up_taken" | "Couldn't sign you in. If this email already has an account, we've emailed its owner: sign in instead, or reset the password if it's yours." |
* | "switcher" | "Switch workspace" |
* | "workspaces" | "Workspaces" |
* | "current" | "Current workspace" |
* | "switch_to" | "Switch to {name}" |
* | "new_workspace" | "New workspace" |
* | "switching" | "Switching…" |
* | "switch_failed" | "Couldn't switch workspaces. Check your connection and try again." |
* | "list_failed" | "Couldn't load your workspaces." |
* | "new_title" | "Create a workspace" |
* | "new_description" | "You'll own it. Your other workspaces stay as they are, and you can switch between them any time." |
* | "cancel" | "Cancel" |
* | "mobile_paging" | "Pages reach this phone from each workspace you've opened on it, as listed under each one. Brigade keeps all of them registered until you sign out or leave th..." |
* | "no_workspace" | "Your account isn't in a workspace yet. Create one to get started, or ask an owner to invite you." |
* | "paging_not_opened" | "Not paged on this phone: switch to it once to get its pages here." |
* | "pages_notice_in" | "This phone isn't paging you in {name}" |
* | "paged_here" | "Paged on this phone" |
* | "sign_out_failed" | "Couldn't sign you out, so you're still signed in. Check your connection and try again." |
* | "sign_out_retry" | "Try signing out again" |
* | * | "Brigade" |
*
* @param {Account_FlowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const account_flow = /** @type {((inputs: Account_FlowInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Account_FlowInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "sign_up_taken") return /** @type {LocalizedString} */ (`Não foi possível entrar. Se este email já tem uma conta, avisamos o dono por email: entre com ela ou redefina a senha, se for sua.`);
		if (i?.part === "switcher") return /** @type {LocalizedString} */ (`Trocar de espaço de trabalho`);
		if (i?.part === "workspaces") return /** @type {LocalizedString} */ (`Espaços de trabalho`);
		if (i?.part === "current") return /** @type {LocalizedString} */ (`Espaço de trabalho atual`);
		if (i?.part === "switch_to") return /** @type {LocalizedString} */ (`Trocar para ${i?.name}`);
		if (i?.part === "new_workspace") return /** @type {LocalizedString} */ (`Novo espaço de trabalho`);
		if (i?.part === "switching") return /** @type {LocalizedString} */ (`Trocando…`);
		if (i?.part === "switch_failed") return /** @type {LocalizedString} */ (`Não foi possível trocar de espaço de trabalho. Confira sua conexão e tente de novo.`);
		if (i?.part === "list_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar seus espaços de trabalho.`);
		if (i?.part === "new_title") return /** @type {LocalizedString} */ (`Criar um espaço de trabalho`);
		if (i?.part === "new_description") return /** @type {LocalizedString} */ (`Você será o proprietário. Seus outros espaços de trabalho continuam como estão, e você pode trocar entre eles quando quiser.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "mobile_paging") return /** @type {LocalizedString} */ (`Este telefone recebe chamados de cada espaço de trabalho que você abriu nele, como mostrado em cada um. O Brigade mantém todos registrados até você sair da conta ou do espaço de trabalho.`);
		if (i?.part === "no_workspace") return /** @type {LocalizedString} */ (`Sua conta ainda não está em um espaço de trabalho. Crie um para começar ou peça a um proprietário para convidar você.`);
		if (i?.part === "paging_not_opened") return /** @type {LocalizedString} */ (`Sem chamados neste telefone: troque para ele uma vez para recebê-los aqui.`);
		if (i?.part === "pages_notice_in") return /** @type {LocalizedString} */ (`Este telefone não está chamando você em ${i?.name}`);
		if (i?.part === "paged_here") return /** @type {LocalizedString} */ (`Recebe chamados neste telefone`);
		if (i?.part === "sign_out_failed") return /** @type {LocalizedString} */ (`Não foi possível sair da conta, então você continua conectado. Confira sua conexão e tente de novo.`);
		if (i?.part === "sign_out_retry") return /** @type {LocalizedString} */ (`Tentar sair de novo`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "sign_up_taken") return /** @type {LocalizedString} */ (`Couldn't sign you in. If this email already has an account, we've emailed its owner: sign in instead, or reset the password if it's yours.`);
		if (i?.part === "switcher") return /** @type {LocalizedString} */ (`Switch workspace`);
		if (i?.part === "workspaces") return /** @type {LocalizedString} */ (`Workspaces`);
		if (i?.part === "current") return /** @type {LocalizedString} */ (`Current workspace`);
		if (i?.part === "switch_to") return /** @type {LocalizedString} */ (`Switch to ${i?.name}`);
		if (i?.part === "new_workspace") return /** @type {LocalizedString} */ (`New workspace`);
		if (i?.part === "switching") return /** @type {LocalizedString} */ (`Switching…`);
		if (i?.part === "switch_failed") return /** @type {LocalizedString} */ (`Couldn't switch workspaces. Check your connection and try again.`);
		if (i?.part === "list_failed") return /** @type {LocalizedString} */ (`Couldn't load your workspaces.`);
		if (i?.part === "new_title") return /** @type {LocalizedString} */ (`Create a workspace`);
		if (i?.part === "new_description") return /** @type {LocalizedString} */ (`You'll own it. Your other workspaces stay as they are, and you can switch between them any time.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "mobile_paging") return /** @type {LocalizedString} */ (`Pages reach this phone from each workspace you've opened on it, as listed under each one. Brigade keeps all of them registered until you sign out or leave the workspace.`);
		if (i?.part === "no_workspace") return /** @type {LocalizedString} */ (`Your account isn't in a workspace yet. Create one to get started, or ask an owner to invite you.`);
		if (i?.part === "paging_not_opened") return /** @type {LocalizedString} */ (`Not paged on this phone: switch to it once to get its pages here.`);
		if (i?.part === "pages_notice_in") return /** @type {LocalizedString} */ (`This phone isn't paging you in ${i?.name}`);
		if (i?.part === "paged_here") return /** @type {LocalizedString} */ (`Paged on this phone`);
		if (i?.part === "sign_out_failed") return /** @type {LocalizedString} */ (`Couldn't sign you out, so you're still signed in. Check your connection and try again.`);
		if (i?.part === "sign_out_retry") return /** @type {LocalizedString} */ (`Try signing out again`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});