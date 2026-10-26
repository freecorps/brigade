/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_VerifyInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "Confirm your email for Brigade" |
* | "intro" | "Confirm that {email} is your address. Until you do, Brigade won't email you about incidents, and you can't invite people or accept invitations." |
* | "open" | "Confirm my email" |
* | "expires" | "The link works for 24 hours." |
* | "footer" | "If you didn't create a Brigade account, ignore this email: nothing happens without the link." |
* | * | "Brigade" |
*
* @param {Email_VerifyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_verify = /** @type {((inputs: Email_VerifyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_VerifyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Confirme seu email no Brigade`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Confirme que ${i?.email} é o seu endereço. Até lá, o Brigade não envia emails sobre incidentes, e você não pode convidar pessoas nem aceitar convites.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Confirmar meu email`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`O link vale por 24 horas.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Se você não criou uma conta no Brigade, ignore este email: nada acontece sem o link.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Confirm your email for Brigade`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Confirm that ${i?.email} is your address. Until you do, Brigade won't email you about incidents, and you can't invite people or accept invitations.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Confirm my email`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`The link works for 24 hours.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`If you didn't create a Brigade account, ignore this email: nothing happens without the link.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});