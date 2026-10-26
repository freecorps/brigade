/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, inviter: NonNullable<unknown>, role: NonNullable<unknown>, email: NonNullable<unknown> }} Accept_PageInputs */



/**
* | part | output |
* | --- | --- |
* | "page_title" | "Invitation" |
* | "title" | "Join {workspace}" |
* | "body" | "{inviter} invited you to join {workspace} on Brigade as {role}." |
* | "body_anonymous" | "You're invited to join {workspace} on Brigade as {role}." |
* | "accept" | "Accept and join" |
* | "accepting" | "Joining…" |
* | "decline" | "Decline" |
* | "declining" | "Declining…" |
* | "declined_title" | "Invitation declined" |
* | "declined_body" | "You won't join {workspace}. Whoever invited you can send a new invitation." |
* | "sign_in_title" | "Sign in to see this invitation" |
* | "sign_in_body" | "Sign in, or create an account, with the email address the invitation was sent to." |
* | "sign_in" | "Sign in" |
* | "sign_up" | "Create an account" |
* | "wrong_email_title" | "This invitation is for another email address" |
* | "wrong_email_body" | "You're signed in as {email}. Sign out, then sign in with the address the invitation was sent to." |
* | "sign_out" | "Sign out" |
* | "unverified_title" | "Confirm your email to accept" |
* | "unverified_body" | "We sent a link to {email}. Open it, and you'll come back here." |
* | "expired_title" | "This invitation has expired" |
* | "expired_body" | "Ask whoever invited you to send it again." |
* | "gone_title" | "This invitation is no longer available" |
* | "gone_body" | "It was already accepted, declined or revoked." |
* | "not_found_title" | "Invitation not found" |
* | "not_found_body" | "Check that you opened the whole link from the email." |
* | "member_title" | "You're already in {workspace}" |
* | "open" | "Open the dashboard" |
* | "decline_prompt" | "Decline the invitation to {workspace}? To join later, you'd need a new invitation." |
* | "decline_confirm" | "Decline invitation" |
* | "cancel" | "Cancel" |
* | "expired_body_named" | "Ask {inviter} to send it again." |
* | "unverified_notice_title" | "Confirm your email to accept" |
* | * | "Invitation" |
*
* @param {Accept_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const accept_page = /** @type {((inputs: Accept_PageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Accept_PageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "page_title") return /** @type {LocalizedString} */ (`Convite`);
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Entrar em ${i?.workspace}`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`${i?.inviter} convidou você para entrar em ${i?.workspace} no Brigade como ${i?.role}.`);
		if (i?.part === "body_anonymous") return /** @type {LocalizedString} */ (`Você foi convidado para entrar em ${i?.workspace} no Brigade como ${i?.role}.`);
		if (i?.part === "accept") return /** @type {LocalizedString} */ (`Aceitar e entrar`);
		if (i?.part === "accepting") return /** @type {LocalizedString} */ (`Entrando…`);
		if (i?.part === "decline") return /** @type {LocalizedString} */ (`Recusar`);
		if (i?.part === "declining") return /** @type {LocalizedString} */ (`Recusando…`);
		if (i?.part === "declined_title") return /** @type {LocalizedString} */ (`Convite recusado`);
		if (i?.part === "declined_body") return /** @type {LocalizedString} */ (`Você não vai entrar em ${i?.workspace}. Quem convidou pode enviar um novo convite.`);
		if (i?.part === "sign_in_title") return /** @type {LocalizedString} */ (`Entre para ver este convite`);
		if (i?.part === "sign_in_body") return /** @type {LocalizedString} */ (`Entre, ou crie uma conta, com o endereço de email para o qual o convite foi enviado.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Entrar`);
		if (i?.part === "sign_up") return /** @type {LocalizedString} */ (`Criar uma conta`);
		if (i?.part === "wrong_email_title") return /** @type {LocalizedString} */ (`Este convite é para outro endereço de email`);
		if (i?.part === "wrong_email_body") return /** @type {LocalizedString} */ (`Você entrou como ${i?.email}. Saia e entre com o endereço para o qual o convite foi enviado.`);
		if (i?.part === "sign_out") return /** @type {LocalizedString} */ (`Sair`);
		if (i?.part === "unverified_title") return /** @type {LocalizedString} */ (`Confirme seu email para aceitar`);
		if (i?.part === "unverified_body") return /** @type {LocalizedString} */ (`Enviamos um link para ${i?.email}. Abra-o e você volta para cá.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`Este convite expirou`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Peça a quem convidou para enviá-lo de novo.`);
		if (i?.part === "gone_title") return /** @type {LocalizedString} */ (`Este convite não está mais disponível`);
		if (i?.part === "gone_body") return /** @type {LocalizedString} */ (`Ele já foi aceito, recusado ou revogado.`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`Convite não encontrado`);
		if (i?.part === "not_found_body") return /** @type {LocalizedString} */ (`Confira se você abriu o link inteiro do email.`);
		if (i?.part === "member_title") return /** @type {LocalizedString} */ (`Você já está em ${i?.workspace}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir o painel`);
		if (i?.part === "decline_prompt") return /** @type {LocalizedString} */ (`Recusar o convite para ${i?.workspace}? Para entrar depois, você vai precisar de um novo convite.`);
		if (i?.part === "decline_confirm") return /** @type {LocalizedString} */ (`Recusar convite`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "expired_body_named") return /** @type {LocalizedString} */ (`Peça a ${i?.inviter} para enviá-lo de novo.`);
		if (i?.part === "unverified_notice_title") return /** @type {LocalizedString} */ (`Confirme seu email para aceitar`);
		return /** @type {LocalizedString} */ (`Convite`)
	}
	{
		if (i?.part === "page_title") return /** @type {LocalizedString} */ (`Invitation`);
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Join ${i?.workspace}`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`${i?.inviter} invited you to join ${i?.workspace} on Brigade as ${i?.role}.`);
		if (i?.part === "body_anonymous") return /** @type {LocalizedString} */ (`You're invited to join ${i?.workspace} on Brigade as ${i?.role}.`);
		if (i?.part === "accept") return /** @type {LocalizedString} */ (`Accept and join`);
		if (i?.part === "accepting") return /** @type {LocalizedString} */ (`Joining…`);
		if (i?.part === "decline") return /** @type {LocalizedString} */ (`Decline`);
		if (i?.part === "declining") return /** @type {LocalizedString} */ (`Declining…`);
		if (i?.part === "declined_title") return /** @type {LocalizedString} */ (`Invitation declined`);
		if (i?.part === "declined_body") return /** @type {LocalizedString} */ (`You won't join ${i?.workspace}. Whoever invited you can send a new invitation.`);
		if (i?.part === "sign_in_title") return /** @type {LocalizedString} */ (`Sign in to see this invitation`);
		if (i?.part === "sign_in_body") return /** @type {LocalizedString} */ (`Sign in, or create an account, with the email address the invitation was sent to.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Sign in`);
		if (i?.part === "sign_up") return /** @type {LocalizedString} */ (`Create an account`);
		if (i?.part === "wrong_email_title") return /** @type {LocalizedString} */ (`This invitation is for another email address`);
		if (i?.part === "wrong_email_body") return /** @type {LocalizedString} */ (`You're signed in as ${i?.email}. Sign out, then sign in with the address the invitation was sent to.`);
		if (i?.part === "sign_out") return /** @type {LocalizedString} */ (`Sign out`);
		if (i?.part === "unverified_title") return /** @type {LocalizedString} */ (`Confirm your email to accept`);
		if (i?.part === "unverified_body") return /** @type {LocalizedString} */ (`We sent a link to ${i?.email}. Open it, and you'll come back here.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`This invitation has expired`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Ask whoever invited you to send it again.`);
		if (i?.part === "gone_title") return /** @type {LocalizedString} */ (`This invitation is no longer available`);
		if (i?.part === "gone_body") return /** @type {LocalizedString} */ (`It was already accepted, declined or revoked.`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`Invitation not found`);
		if (i?.part === "not_found_body") return /** @type {LocalizedString} */ (`Check that you opened the whole link from the email.`);
		if (i?.part === "member_title") return /** @type {LocalizedString} */ (`You're already in ${i?.workspace}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open the dashboard`);
		if (i?.part === "decline_prompt") return /** @type {LocalizedString} */ (`Decline the invitation to ${i?.workspace}? To join later, you'd need a new invitation.`);
		if (i?.part === "decline_confirm") return /** @type {LocalizedString} */ (`Decline invitation`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "expired_body_named") return /** @type {LocalizedString} */ (`Ask ${i?.inviter} to send it again.`);
		if (i?.part === "unverified_notice_title") return /** @type {LocalizedString} */ (`Confirm your email to accept`);
		return /** @type {LocalizedString} */ (`Invitation`)
	}
});