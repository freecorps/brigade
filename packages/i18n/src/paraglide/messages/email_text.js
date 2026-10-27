/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, incident: NonNullable<unknown>, title: NonNullable<unknown>, workspace: NonNullable<unknown>, reason: NonNullable<unknown>, url: NonNullable<unknown> }} Email_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "unpaged_subject" | "{incident}: {title} (Brigade couldn't page you)" |
* | "unpaged_intro" | "Brigade tried to page you about {incident} in {workspace}, but the page didn't reach your phone: {reason}." |
* | "unpaged_reason_no_devices" | "you have no phone registered with Brigade" |
* | "unpaged_reason_undelivered" | "the push notification didn't go through" |
* | "unpaged_reason_token_invalid" | "Apple refused your phone's token, so Brigade removed that phone" |
* | "unpaged_reason_unsupported" | "Brigade can't send pages to Android phones yet" |
* | "unpaged_reason_not_configured" | "push notifications aren't set up on this Brigade server" |
* | "unpaged_reason_over_limit" | "the page went to more phones than one page can reach" |
* | "unpaged_hint" | "To get pages on your phone, install the Brigade app, sign in and allow notifications." |
* | "unpaged_footer" | "You're getting this email because you can respond to incidents in {workspace}." |
* | "nobody_subject" | "Nobody could be paged for {incident}: {title}" |
* | "nobody_intro" | "Nobody could be paged for {incident} in {workspace}. Brigade tried everyone it could and the page reached no one's phone, and nobody has acknowledged the inc..." |
* | "nobody_timeline" | "The incident's timeline says why each page failed." |
* | "nobody_footer" | "You're getting this email because you're an owner of {workspace}." |
* | "fact_incident" | "Incident: {incident}" |
* | "fact_title" | "Title: {title}" |
* | "open" | "Open the incident" |
* | * | "Brigade" |
*
* @param {Email_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_text = /** @type {((inputs: Email_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "unpaged_subject") return /** @type {LocalizedString} */ (`${i?.incident}: ${i?.title} (o Brigade não conseguiu chamar você)`);
		if (i?.part === "unpaged_intro") return /** @type {LocalizedString} */ (`O Brigade tentou chamar você sobre ${i?.incident} em ${i?.workspace}, mas a chamada não chegou ao seu celular: ${i?.reason}.`);
		if (i?.part === "unpaged_reason_no_devices") return /** @type {LocalizedString} */ (`você não tem nenhum celular registrado no Brigade`);
		if (i?.part === "unpaged_reason_undelivered") return /** @type {LocalizedString} */ (`a notificação push não foi entregue`);
		if (i?.part === "unpaged_reason_token_invalid") return /** @type {LocalizedString} */ (`a Apple recusou o token do seu celular, então o Brigade removeu esse celular`);
		if (i?.part === "unpaged_reason_unsupported") return /** @type {LocalizedString} */ (`o Brigade ainda não envia chamadas para celulares Android`);
		if (i?.part === "unpaged_reason_not_configured") return /** @type {LocalizedString} */ (`as notificações push não estão configuradas neste servidor do Brigade`);
		if (i?.part === "unpaged_reason_over_limit") return /** @type {LocalizedString} */ (`a chamada foi para mais celulares do que uma chamada alcança`);
		if (i?.part === "unpaged_hint") return /** @type {LocalizedString} */ (`Para receber chamadas no celular, instale o app do Brigade, entre na sua conta e permita notificações.`);
		if (i?.part === "unpaged_footer") return /** @type {LocalizedString} */ (`Você está recebendo este email porque pode responder a incidentes em ${i?.workspace}.`);
		if (i?.part === "nobody_subject") return /** @type {LocalizedString} */ (`Ninguém pôde ser chamado para ${i?.incident}: ${i?.title}`);
		if (i?.part === "nobody_intro") return /** @type {LocalizedString} */ (`Ninguém pôde ser chamado para ${i?.incident} em ${i?.workspace}. O Brigade tentou todos que podia e a chamada não chegou ao celular de ninguém, e ninguém confirmou o incidente.`);
		if (i?.part === "nobody_timeline") return /** @type {LocalizedString} */ (`A linha do tempo do incidente mostra por que cada chamada falhou.`);
		if (i?.part === "nobody_footer") return /** @type {LocalizedString} */ (`Você está recebendo este email porque é proprietário de ${i?.workspace}.`);
		if (i?.part === "fact_incident") return /** @type {LocalizedString} */ (`Incidente: ${i?.incident}`);
		if (i?.part === "fact_title") return /** @type {LocalizedString} */ (`Título: ${i?.title}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir o incidente`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "unpaged_subject") return /** @type {LocalizedString} */ (`${i?.incident}: ${i?.title} (Brigade couldn't page you)`);
		if (i?.part === "unpaged_intro") return /** @type {LocalizedString} */ (`Brigade tried to page you about ${i?.incident} in ${i?.workspace}, but the page didn't reach your phone: ${i?.reason}.`);
		if (i?.part === "unpaged_reason_no_devices") return /** @type {LocalizedString} */ (`you have no phone registered with Brigade`);
		if (i?.part === "unpaged_reason_undelivered") return /** @type {LocalizedString} */ (`the push notification didn't go through`);
		if (i?.part === "unpaged_reason_token_invalid") return /** @type {LocalizedString} */ (`Apple refused your phone's token, so Brigade removed that phone`);
		if (i?.part === "unpaged_reason_unsupported") return /** @type {LocalizedString} */ (`Brigade can't send pages to Android phones yet`);
		if (i?.part === "unpaged_reason_not_configured") return /** @type {LocalizedString} */ (`push notifications aren't set up on this Brigade server`);
		if (i?.part === "unpaged_reason_over_limit") return /** @type {LocalizedString} */ (`the page went to more phones than one page can reach`);
		if (i?.part === "unpaged_hint") return /** @type {LocalizedString} */ (`To get pages on your phone, install the Brigade app, sign in and allow notifications.`);
		if (i?.part === "unpaged_footer") return /** @type {LocalizedString} */ (`You're getting this email because you can respond to incidents in ${i?.workspace}.`);
		if (i?.part === "nobody_subject") return /** @type {LocalizedString} */ (`Nobody could be paged for ${i?.incident}: ${i?.title}`);
		if (i?.part === "nobody_intro") return /** @type {LocalizedString} */ (`Nobody could be paged for ${i?.incident} in ${i?.workspace}. Brigade tried everyone it could and the page reached no one's phone, and nobody has acknowledged the incident.`);
		if (i?.part === "nobody_timeline") return /** @type {LocalizedString} */ (`The incident's timeline says why each page failed.`);
		if (i?.part === "nobody_footer") return /** @type {LocalizedString} */ (`You're getting this email because you're an owner of ${i?.workspace}.`);
		if (i?.part === "fact_incident") return /** @type {LocalizedString} */ (`Incident: ${i?.incident}`);
		if (i?.part === "fact_title") return /** @type {LocalizedString} */ (`Title: ${i?.title}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open the incident`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});