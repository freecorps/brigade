/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, webhook: NonNullable<unknown>, failures: NonNullable<unknown> }} Email_Webhook_DisabledInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "A webhook in {workspace} was turned off" |
* | "intro" | "Brigade turned off the webhook {webhook} in {workspace}: its last {failures} deliveries failed, over more than a day." |
* | "how" | "Fix the endpoint, then turn it back on from the Webhooks card on the dashboard. Events from while it was off aren't sent." |
* | "open" | "Open the dashboard" |
* | "footer" | "You get this email because you're an owner of {workspace} on Brigade." |
* | * | "A webhook in {workspace} was turned off" |
*
* @param {Email_Webhook_DisabledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_webhook_disabled = /** @type {((inputs: Email_Webhook_DisabledInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Webhook_DisabledInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Um webhook em ${i?.workspace} foi desligado`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`O Brigade desligou o webhook ${i?.webhook} em ${i?.workspace}: as últimas ${i?.failures} entregas falharam, por mais de um dia.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`Corrija o endpoint e ligue-o de novo no cartão Webhooks do painel. Eventos de enquanto ele estava desligado não são enviados.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir o painel`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Você recebe este email porque é proprietário de ${i?.workspace} no Brigade.`);
		return /** @type {LocalizedString} */ (`Um webhook em ${i?.workspace} foi desligado`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`A webhook in ${i?.workspace} was turned off`);
		if (i?.part === "intro") return /** @type {LocalizedString} */ (`Brigade turned off the webhook ${i?.webhook} in ${i?.workspace}: its last ${i?.failures} deliveries failed, over more than a day.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`Fix the endpoint, then turn it back on from the Webhooks card on the dashboard. Events from while it was off aren't sent.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open the dashboard`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`You get this email because you're an owner of ${i?.workspace} on Brigade.`);
		return /** @type {LocalizedString} */ (`A webhook in ${i?.workspace} was turned off`)
	}
});