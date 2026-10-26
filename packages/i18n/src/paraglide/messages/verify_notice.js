/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Verify_NoticeInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Confirm your email" |
* | "body" | "We sent a link to {email}. Until you open it, Brigade won't email you, and you can't invite people or accept invitations." |
* | "resend" | "Send the link again" |
* | "sending" | "Sending…" |
* | "sent" | "Sent. Open the newest email from Brigade (check spam too)." |
* | "rate_limited" | "You asked for several links just now. Wait a few minutes and try again." |
* | "not_configured" | "This Brigade server can't send email yet. Ask whoever runs it." |
* | "failed" | "Couldn't send the link. Try again." |
* | * | "Confirm your email" |
*
* @param {Verify_NoticeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const verify_notice = /** @type {((inputs: Verify_NoticeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Verify_NoticeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Confirme seu email`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`Enviamos um link para ${i?.email}. Até você abri-lo, o Brigade não envia emails para você, e você não pode convidar pessoas nem aceitar convites.`);
		if (i?.part === "resend") return /** @type {LocalizedString} */ (`Enviar o link de novo`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Enviando…`);
		if (i?.part === "sent") return /** @type {LocalizedString} */ (`Enviado. Abra o email mais recente do Brigade (veja também o spam).`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`Você pediu vários links agora há pouco. Espere alguns minutos e tente de novo.`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`Este servidor do Brigade ainda não envia emails. Fale com quem o administra.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível enviar o link. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Confirme seu email`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Confirm your email`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`We sent a link to ${i?.email}. Until you open it, Brigade won't email you, and you can't invite people or accept invitations.`);
		if (i?.part === "resend") return /** @type {LocalizedString} */ (`Send the link again`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Sending…`);
		if (i?.part === "sent") return /** @type {LocalizedString} */ (`Sent. Open the newest email from Brigade (check spam too).`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`You asked for several links just now. Wait a few minutes and try again.`);
		if (i?.part === "not_configured") return /** @type {LocalizedString} */ (`This Brigade server can't send email yet. Ask whoever runs it.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't send the link. Try again.`);
		return /** @type {LocalizedString} */ (`Confirm your email`)
	}
});