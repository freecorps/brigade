/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Verify_PageInputs */



/**
* | part | output |
* | --- | --- |
* | "page_title" | "Confirm email" |
* | "checking" | "Confirming your email…" |
* | "done_title" | "Email confirmed" |
* | "done_body" | "Brigade can now email you, and you can invite people and accept invitations." |
* | "expired_title" | "This link has expired" |
* | "expired_body" | "Links work for 24 hours. Sign in and ask for a new one." |
* | "invalid_title" | "This link doesn't work" |
* | "invalid_body" | "It may have been cut off when you opened it. Sign in and ask for a new one." |
* | "failed_body" | "Couldn't reach Brigade. Check your connection and try again." |
* | "retry" | "Try again" |
* | "continue" | "Continue" |
* | "done_body_invitation" | "Your email is confirmed. You can accept the invitation now." |
* | "expired_body_signed_in" | "Links work for 24 hours. Ask for a new one from the dashboard." |
* | "invalid_body_signed_in" | "It may have been cut off when you opened it. Ask for a new one from the dashboard." |
* | "open" | "Open the dashboard" |
* | * | "Confirm email" |
*
* @param {Verify_PageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const verify_page = /** @type {((inputs: Verify_PageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Verify_PageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "page_title") return /** @type {LocalizedString} */ (`Confirmar email`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Confirmando seu email…`);
		if (i?.part === "done_title") return /** @type {LocalizedString} */ (`Email confirmado`);
		if (i?.part === "done_body") return /** @type {LocalizedString} */ (`Agora o Brigade pode enviar emails para você, e você pode convidar pessoas e aceitar convites.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`Este link expirou`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Os links valem por 24 horas. Entre e peça um novo.`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`Este link não funciona`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`Ele pode ter sido cortado ao ser aberto. Entre e peça um novo.`);
		if (i?.part === "failed_body") return /** @type {LocalizedString} */ (`Não foi possível falar com o Brigade. Verifique sua conexão e tente de novo.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "continue") return /** @type {LocalizedString} */ (`Continuar`);
		if (i?.part === "done_body_invitation") return /** @type {LocalizedString} */ (`Seu email está confirmado. Agora você pode aceitar o convite.`);
		if (i?.part === "expired_body_signed_in") return /** @type {LocalizedString} */ (`Os links valem por 24 horas. Peça um novo pelo painel.`);
		if (i?.part === "invalid_body_signed_in") return /** @type {LocalizedString} */ (`Ele pode ter sido cortado ao ser aberto. Peça um novo pelo painel.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir o painel`);
		return /** @type {LocalizedString} */ (`Confirmar email`)
	}
	{
		if (i?.part === "page_title") return /** @type {LocalizedString} */ (`Confirm email`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Confirming your email…`);
		if (i?.part === "done_title") return /** @type {LocalizedString} */ (`Email confirmed`);
		if (i?.part === "done_body") return /** @type {LocalizedString} */ (`Brigade can now email you, and you can invite people and accept invitations.`);
		if (i?.part === "expired_title") return /** @type {LocalizedString} */ (`This link has expired`);
		if (i?.part === "expired_body") return /** @type {LocalizedString} */ (`Links work for 24 hours. Sign in and ask for a new one.`);
		if (i?.part === "invalid_title") return /** @type {LocalizedString} */ (`This link doesn't work`);
		if (i?.part === "invalid_body") return /** @type {LocalizedString} */ (`It may have been cut off when you opened it. Sign in and ask for a new one.`);
		if (i?.part === "failed_body") return /** @type {LocalizedString} */ (`Couldn't reach Brigade. Check your connection and try again.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "continue") return /** @type {LocalizedString} */ (`Continue`);
		if (i?.part === "done_body_invitation") return /** @type {LocalizedString} */ (`Your email is confirmed. You can accept the invitation now.`);
		if (i?.part === "expired_body_signed_in") return /** @type {LocalizedString} */ (`Links work for 24 hours. Ask for a new one from the dashboard.`);
		if (i?.part === "invalid_body_signed_in") return /** @type {LocalizedString} */ (`It may have been cut off when you opened it. Ask for a new one from the dashboard.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open the dashboard`);
		return /** @type {LocalizedString} */ (`Confirm email`)
	}
});