/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_ResetInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "Reset your Brigade password" |
* | "intro" | "Someone asked to reset the password of the Brigade account for {email}. If it was you, choose a new password with this link." |
* | "open" | "Choose a new password" |
* | "expires" | "The link works once, for 1 hour. Setting a new password signs the account out everywhere, including phones, and confirms this email address." |
* | "footer" | "If you didn't ask for this, ignore this email: your password stays as it is." |
* | * | "Brigade" |
*
* @param {Email_ResetInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_reset = /** @type {((inputs: Email_ResetInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_ResetInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Redefina sua senha do Brigade`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Alguém pediu para redefinir a senha da conta do Brigade de ${i?.email}. Se foi você, escolha uma nova senha por este link.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Escolher nova senha`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`O link vale uma vez, por 1 hora. Definir uma nova senha encerra a sessão da conta em todos os lugares, inclusive nos celulares, e confirma este endereço de email.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Se você não pediu isso, ignore este email: sua senha continua a mesma.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Reset your Brigade password`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Someone asked to reset the password of the Brigade account for ${i?.email}. If it was you, choose a new password with this link.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Choose a new password`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`The link works once, for 1 hour. Setting a new password signs the account out everywhere, including phones, and confirms this email address.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`If you didn't ask for this, ignore this email: your password stays as it is.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});