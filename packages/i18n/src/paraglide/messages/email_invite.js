/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, inviter: NonNullable<unknown>, workspace: NonNullable<unknown>, role: NonNullable<unknown> }} Email_InviteInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "{inviter} invited you to {workspace} on Brigade" |
* | "intro" | "{inviter} invited you to join {workspace} on Brigade, where the team responds to incidents, as {role}." |
* | "how" | "To accept, sign in or create a Brigade account with this email address, and confirm it." |
* | "open" | "See the invitation" |
* | "expires" | "The invitation expires in 7 days." |
* | "footer" | "If you weren't expecting this, ignore this email: nobody joins without accepting." |
* | * | "Brigade" |
*
* @param {Email_InviteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_invite = /** @type {((inputs: Email_InviteInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_InviteInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`${i?.inviter} convidou você para ${i?.workspace} no Brigade`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`${i?.inviter} convidou você para entrar em ${i?.workspace} no Brigade, onde a equipe responde a incidentes, como ${i?.role}.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`Para aceitar, entre ou crie uma conta no Brigade com este endereço de email e confirme-o.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Ver o convite`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`O convite expira em 7 dias.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Se você não esperava por isto, ignore este email: ninguém entra sem aceitar.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`${i?.inviter} invited you to ${i?.workspace} on Brigade`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`${i?.inviter} invited you to join ${i?.workspace} on Brigade, where the team responds to incidents, as ${i?.role}.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`To accept, sign in or create a Brigade account with this email address, and confirm it.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`See the invitation`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`The invitation expires in 7 days.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`If you weren't expecting this, ignore this email: nobody joins without accepting.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});