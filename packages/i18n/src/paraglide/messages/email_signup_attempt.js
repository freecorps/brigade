/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown> }} Email_Signup_AttemptInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "Someone tried to sign up with your email" |
* | "intro" | "Someone tried to create a Brigade account with {email}, which already has one. Nothing changed: no account was created and your password is the same." |
* | "open" | "Sign in to Brigade" |
* | "reset" | "If it was you, sign in instead. Forgot your password? Choose a new one from \"Forgot your password?\" on the sign-in page." |
* | "footer" | "If it wasn't you, ignore this email." |
* | * | "Brigade" |
*
* @param {Email_Signup_AttemptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_signup_attempt = /** @type {((inputs: Email_Signup_AttemptInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Signup_AttemptInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Alguém tentou se cadastrar com seu email`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Alguém tentou criar uma conta no Brigade com ${i?.email}, que já tem uma. Nada mudou: nenhuma conta foi criada e sua senha continua a mesma.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Entrar no Brigade`);
		if (i?.part === "reset") return /** @type {LocalizedString} */ (`Se foi você, entre na sua conta. Esqueceu a senha? Escolha uma nova em "Esqueceu a senha?" na página de entrada.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Se não foi você, ignore este email.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Someone tried to sign up with your email`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Someone tried to create a Brigade account with ${i?.email}, which already has one. Nothing changed: no account was created and your password is the same.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Sign in to Brigade`);
		if (i?.part === "reset") return /** @type {LocalizedString} */ (`If it was you, sign in instead. Forgot your password? Choose a new one from "Forgot your password?" on the sign-in page.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`If it wasn't you, ignore this email.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});