/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown>, page: NonNullable<unknown> }} Status_SubscribeInputs */



/**
* | part | output |
* | --- | --- |
* | "form_title" | "Get email updates" |
* | "form_hint" | "We'll email you when an incident is posted here or maintenance is planned. You confirm from your inbox and can unsubscribe at any time." |
* | "email_label" | "Email address" |
* | "submit" | "Subscribe" |
* | "honeypot" | "Leave this field empty" |
* | "check_title" | "Check your inbox" |
* | "check_body" | "If {email} isn't subscribed to {page} yet, we've sent it a link to confirm. The link expires in 48 hours." |
* | "invalid_title" | "Check the address" |
* | "invalid_body" | "That doesn't look like an email address. Go back and try again." |
* | "limited_title" | "Too many requests" |
* | "limited_body" | "Too many subscriptions were asked for just now. Try again in a minute." |
* | "confirm_title" | "Confirm your subscription" |
* | "confirm_body" | "Confirm to get email updates from {page}." |
* | "confirm_button" | "Confirm subscription" |
* | "confirmed_title" | "You're subscribed" |
* | "confirmed_body" | "You'll get an email when {page} posts an incident or plans maintenance. Every email has a link to unsubscribe." |
* | "expired_title" | "This link has expired" |
* | "expired_body" | "Subscribe again from the status page to get a new one." |
* | "manage_title" | "Email updates" |
* | "manage_body" | "{email} gets email updates from {page}." |
* | "unsubscribe_button" | "Unsubscribe" |
* | "unsubscribed_title" | "You're unsubscribed" |
* | "unsubscribed_body" | "You won't get any more emails from {page}." |
* | "back" | "Back to the status page" |
* | * | "Email updates" |
*
* @param {Status_SubscribeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_subscribe = /** @type {((inputs: Status_SubscribeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_SubscribeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "form_title") return /** @type {LocalizedString} */ (`Receba atualizações por email`);
		if (i?.part === "form_hint") return /** @type {LocalizedString} */ (`Enviamos um email quando um incidente for publicado aqui ou uma manutenção for programada. Você confirma pela sua caixa de entrada e pode cancelar quando quiser.`);
		if (i?.part === "email_label") return /** @type {LocalizedString} */ (`Endereço de email`);
		if (i?.part === "submit") return /** @type {LocalizedString} */ (`Inscrever-se`);
		if (i?.part === "honeypot") return /** @type {LocalizedString} */ (`Deixe este campo vazio`);
		if (i?.part === "check_title") return /** @type {LocalizedString} */ (`Confira sua caixa de entrada`);
		if (i?.part === "check_body") return /** @type {LocalizedString} */ (`Se ${i?.email} ainda não estiver inscrito em ${i?.page}, enviamos um link para confirmar. O link expira em 48 horas.`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`Confira o endereço`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`Isso não parece um endereço de email. Volte e tente de novo.`);
		if (i?.part === "limited_title") return /** @type {LocalizedString} */ (`Pedidos demais`);
		if (i?.part === "limited_body") return /** @type {LocalizedString} */ (`Pediram inscrições demais agora há pouco. Tente de novo em um minuto.`);
		if (i?.part === "confirm_title") return /** @type {LocalizedString} */ (`Confirme sua inscrição`);
		if (i?.part === "confirm_body") return /** @type {LocalizedString} */ (`Confirme para receber atualizações de ${i?.page} por email.`);
		if (i?.part === "confirm_button") return /** @type {LocalizedString} */ (`Confirmar inscrição`);
		if (i?.part === "confirmed_title") return /** @type {LocalizedString} */ (`Inscrição confirmada`);
		if (i?.part === "confirmed_body") return /** @type {LocalizedString} */ (`Você vai receber um email quando ${i?.page} publicar um incidente ou programar uma manutenção. Todo email tem um link para cancelar a inscrição.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`Este link expirou`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Inscreva-se de novo pela página de status para receber um novo link.`);
		if (i?.part === "manage_title") return /** @type {LocalizedString} */ (`Atualizações por email`);
		if (i?.part === "manage_body") return /** @type {LocalizedString} */ (`${i?.email} recebe atualizações de ${i?.page} por email.`);
		if (i?.part === "unsubscribe_button") return /** @type {LocalizedString} */ (`Cancelar inscrição`);
		if (i?.part === "unsubscribed_title") return /** @type {LocalizedString} */ (`Inscrição cancelada`);
		if (i?.part === "unsubscribed_body") return /** @type {LocalizedString} */ (`Você não vai receber mais emails de ${i?.page}.`);
		if (i?.part === "back") return /** @type {LocalizedString} */ (`Voltar para a página de status`);
		return /** @type {LocalizedString} */ (`Atualizações por email`)
	}
	{
		if (i?.part === "form_title") return /** @type {LocalizedString} */ (`Get email updates`);
		if (i?.part === "form_hint") return /** @type {LocalizedString} */ (`We'll email you when an incident is posted here or maintenance is planned. You confirm from your inbox and can unsubscribe at any time.`);
		if (i?.part === "email_label") return /** @type {LocalizedString} */ (`Email address`);
		if (i?.part === "submit") return /** @type {LocalizedString} */ (`Subscribe`);
		if (i?.part === "honeypot") return /** @type {LocalizedString} */ (`Leave this field empty`);
		if (i?.part === "check_title") return /** @type {LocalizedString} */ (`Check your inbox`);
		if (i?.part === "check_body") return /** @type {LocalizedString} */ (`If ${i?.email} isn't subscribed to ${i?.page} yet, we've sent it a link to confirm. The link expires in 48 hours.`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`Check the address`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`That doesn't look like an email address. Go back and try again.`);
		if (i?.part === "limited_title") return /** @type {LocalizedString} */ (`Too many requests`);
		if (i?.part === "limited_body") return /** @type {LocalizedString} */ (`Too many subscriptions were asked for just now. Try again in a minute.`);
		if (i?.part === "confirm_title") return /** @type {LocalizedString} */ (`Confirm your subscription`);
		if (i?.part === "confirm_body") return /** @type {LocalizedString} */ (`Confirm to get email updates from ${i?.page}.`);
		if (i?.part === "confirm_button") return /** @type {LocalizedString} */ (`Confirm subscription`);
		if (i?.part === "confirmed_title") return /** @type {LocalizedString} */ (`You're subscribed`);
		if (i?.part === "confirmed_body") return /** @type {LocalizedString} */ (`You'll get an email when ${i?.page} posts an incident or plans maintenance. Every email has a link to unsubscribe.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`This link has expired`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Subscribe again from the status page to get a new one.`);
		if (i?.part === "manage_title") return /** @type {LocalizedString} */ (`Email updates`);
		if (i?.part === "manage_body") return /** @type {LocalizedString} */ (`${i?.email} gets email updates from ${i?.page}.`);
		if (i?.part === "unsubscribe_button") return /** @type {LocalizedString} */ (`Unsubscribe`);
		if (i?.part === "unsubscribed_title") return /** @type {LocalizedString} */ (`You're unsubscribed`);
		if (i?.part === "unsubscribed_body") return /** @type {LocalizedString} */ (`You won't get any more emails from ${i?.page}.`);
		if (i?.part === "back") return /** @type {LocalizedString} */ (`Back to the status page`);
		return /** @type {LocalizedString} */ (`Email updates`)
	}
});