/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Reset_PageInputs */



/**
* | part | output |
* | --- | --- |
* | "forgot_link" | "Forgot your password?" |
* | "forgot_page_title" | "Forgot password" |
* | "forgot_title" | "Reset your password" |
* | "forgot_description" | "Enter the email you signed up with. We'll send you a link to choose a new password." |
* | "send" | "Send the link" |
* | "sending" | "Sending…" |
* | "sent_title" | "Check your email" |
* | "sent_body" | "If {email} has a Brigade account, a link to choose a new password is on its way. It works for 1 hour. Check spam too." |
* | "other_address" | "Use another address" |
* | "rate_limited" | "Too many links asked for this address. Try again in an hour." |
* | "not_configured" | "This Brigade server can't send email yet. Ask whoever runs it." |
* | "failed" | "Couldn't send the link. Try again." |
* | "back" | "Back to sign in" |
* | "reset_page_title" | "New password" |
* | "reset_title" | "Choose a new password" |
* | "reset_description" | "Saving it signs your account out everywhere, including the app on your phone." |
* | "new_password_label" | "New password" |
* | "save" | "Save new password" |
* | "saving" | "Saving…" |
* | "done_title" | "Password changed" |
* | "done_body" | "Sign in with your new password. Every session was signed out, and your email address is confirmed. Your phones get no pages until you sign in to the app again." |
* | "sign_in" | "Sign in" |
* | "invalid_title" | "This link doesn't work" |
* | "invalid_body" | "It may have expired (links work for 1 hour), been used already, or been cut off. Ask for a new one." |
* | "request_new" | "Send a new link" |
* | "uncertain" | "Brigade hit an error after receiving your new password, so it may already be saved. Try signing in with it; if that doesn't work, ask for a new link." |
* | * | "Reset your password" |
*
* @param {Reset_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const reset_page = /** @type {((inputs: Reset_PageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Reset_PageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "forgot_link") return /** @type {LocalizedString} */ (`Esqueceu a senha?`);
		if (i?.part === "forgot_page_title") return /** @type {LocalizedString} */ (`Esqueci a senha`);
		if (i?.part === "forgot_title") return /** @type {LocalizedString} */ (`Redefinir sua senha`);
		if (i?.part === "forgot_description") return /** @type {LocalizedString} */ (`Informe o e-mail do seu cadastro. Enviaremos um link para você escolher uma nova senha.`);
		if (i?.part === "send") return /** @type {LocalizedString} */ (`Enviar o link`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Enviando…`);
		if (i?.part === "sent_title") return /** @type {LocalizedString} */ (`Confira seu e-mail`);
		if (i?.part === "sent_body") return /** @type {LocalizedString} */ (`Se ${i?.email} tiver uma conta no Brigade, um link para escolher uma nova senha está a caminho. Ele vale por 1 hora. Confira também o spam.`);
		if (i?.part === "other_address") return /** @type {LocalizedString} */ (`Usar outro endereço`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`Muitos links pedidos para este endereço. Tente de novo em uma hora.`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`Este servidor do Brigade ainda não envia e-mails. Fale com quem o administra.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível enviar o link. Tente de novo.`);
		if (i?.part === "back") return /** @type {LocalizedString} */ (`Voltar para entrar`);
		if (i?.part === "reset_page_title") return /** @type {LocalizedString} */ (`Nova senha`);
		if (i?.part === "reset_title") return /** @type {LocalizedString} */ (`Escolha uma nova senha`);
		if (i?.part === "reset_description") return /** @type {LocalizedString} */ (`Ao salvar, sua conta é desconectada em todos os lugares, inclusive no app do celular.`);
		if (i?.part === "new_password_label") return /** @type {LocalizedString} */ (`Nova senha`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar nova senha`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "done_title") return /** @type {LocalizedString} */ (`Senha alterada`);
		if (i?.part === "done_body") return /** @type {LocalizedString} */ (`Entre com a nova senha. Todas as sessões foram encerradas, e seu endereço de e-mail está confirmado. Seus celulares não recebem acionamentos até você entrar no app de novo.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Entrar`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`Este link não funciona`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`Ele pode ter expirado (os links valem por 1 hora), já ter sido usado ou ter sido cortado. Peça um novo.`);
		if (i?.part === "request_new") return /** @type {LocalizedString} */ (`Enviar um novo link`);
		if (i?.part === "uncertain") return /** @type {LocalizedString} */ (`O Brigade teve um erro depois de receber sua nova senha, então ela pode já estar salva. Tente entrar com ela; se não funcionar, peça um novo link.`);
		return /** @type {LocalizedString} */ (`Redefinir sua senha`)
	}
	{
		if (i?.part === "forgot_link") return /** @type {LocalizedString} */ (`Forgot your password?`);
		if (i?.part === "forgot_page_title") return /** @type {LocalizedString} */ (`Forgot password`);
		if (i?.part === "forgot_title") return /** @type {LocalizedString} */ (`Reset your password`);
		if (i?.part === "forgot_description") return /** @type {LocalizedString} */ (`Enter the email you signed up with. We'll send you a link to choose a new password.`);
		if (i?.part === "send") return /** @type {LocalizedString} */ (`Send the link`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Sending…`);
		if (i?.part === "sent_title") return /** @type {LocalizedString} */ (`Check your email`);
		if (i?.part === "sent_body") return /** @type {LocalizedString} */ (`If ${i?.email} has a Brigade account, a link to choose a new password is on its way. It works for 1 hour. Check spam too.`);
		if (i?.part === "other_address") return /** @type {LocalizedString} */ (`Use another address`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`Too many links asked for this address. Try again in an hour.`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`This Brigade server can't send email yet. Ask whoever runs it.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't send the link. Try again.`);
		if (i?.part === "back") return /** @type {LocalizedString} */ (`Back to sign in`);
		if (i?.part === "reset_page_title") return /** @type {LocalizedString} */ (`New password`);
		if (i?.part === "reset_title") return /** @type {LocalizedString} */ (`Choose a new password`);
		if (i?.part === "reset_description") return /** @type {LocalizedString} */ (`Saving it signs your account out everywhere, including the app on your phone.`);
		if (i?.part === "new_password_label") return /** @type {LocalizedString} */ (`New password`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save new password`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "done_title") return /** @type {LocalizedString} */ (`Password changed`);
		if (i?.part === "done_body") return /** @type {LocalizedString} */ (`Sign in with your new password. Every session was signed out, and your email address is confirmed. Your phones get no pages until you sign in to the app again.`);
		if (i?.part === "sign_in") return /** @type {LocalizedString} */ (`Sign in`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`This link doesn't work`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`It may have expired (links work for 1 hour), been used already, or been cut off. Ask for a new one.`);
		if (i?.part === "request_new") return /** @type {LocalizedString} */ (`Send a new link`);
		if (i?.part === "uncertain") return /** @type {LocalizedString} */ (`Brigade hit an error after receiving your new password, so it may already be saved. Try signing in with it; if that doesn't work, ask for a new link.`);
		return /** @type {LocalizedString} */ (`Reset your password`)
	}
});