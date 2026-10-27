/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, page: NonNullable<unknown>, title: NonNullable<unknown>, status: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown>, list: NonNullable<unknown> }} Email_StatusInputs */



/**
* | part | output |
* | --- | --- |
* | "confirm_subject" | "Confirm your subscription to {page}" |
* | "confirm_intro" | "Someone, hopefully you, asked for email updates from the {page} status page at this address." |
* | "confirm_open" | "Confirm subscription" |
* | "confirm_after" | "The link expires in 48 hours. If you didn't ask for this, ignore this email: you won't get anything else." |
* | "confirm_footer" | "You get this email because this address was entered on the {page} status page." |
* | "incident_created_subject" | "{page}: {title}" |
* | "incident_updated_subject" | "{page} update: {title}" |
* | "incident_resolved_subject" | "{page} resolved: {title}" |
* | "maintenance_scheduled_subject" | "{page} scheduled maintenance: {title}" |
* | "maintenance_started_subject" | "{page} maintenance started: {title}" |
* | "maintenance_ended_subject" | "{page} maintenance completed: {title}" |
* | "maintenance_cancelled_subject" | "{page} maintenance called off: {title}" |
* | "status" | "Status: {status}" |
* | "affects" | "Affects {list}" |
* | "window" | "{time} to {until} UTC" |
* | "started" | "The maintenance has started. It's planned to end {until} UTC." |
* | "ended" | "The maintenance is over." |
* | "cancelled" | "This maintenance won't happen." |
* | "open" | "View the status page" |
* | "footer" | "You get this email because you subscribed to updates from {page}." |
* | "manage" | "Manage your subscription" |
* | "unsubscribe" | "Unsubscribe" |
* | * | "{page}" |
*
* @param {Email_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_status = /** @type {((inputs: Email_StatusInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_StatusInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "confirm_subject") return /** @type {LocalizedString} */ (`Confirme sua inscrição em ${i?.page}`);
		if (i?.part === "confirm_intro") return /** @type {LocalizedString} */ (`Alguém, provavelmente você, pediu para receber neste endereço as atualizações da página de status de ${i?.page}.`);
		if (i?.part === "confirm_open") return /** @type {LocalizedString} */ (`Confirmar inscrição`);
		if (i?.part === "confirm_after") return /** @type {LocalizedString} */ (`O link expira em 48 horas. Se não foi você, ignore este email: você não vai receber mais nada.`);
		if (i?.part === "confirm_footer") return /** @type {LocalizedString} */ (`Você recebeu este email porque este endereço foi informado na página de status de ${i?.page}.`);
		if (i?.part === "incident_created_subject") return /** @type {LocalizedString} */ (`${i?.page}: ${i?.title}`);
		if (i?.part === "incident_updated_subject") return /** @type {LocalizedString} */ (`${i?.page}, atualização: ${i?.title}`);
		if (i?.part === "incident_resolved_subject") return /** @type {LocalizedString} */ (`${i?.page}, resolvido: ${i?.title}`);
		if (i?.part === "maintenance_scheduled_subject") return /** @type {LocalizedString} */ (`${i?.page}, manutenção programada: ${i?.title}`);
		if (i?.part === "maintenance_started_subject") return /** @type {LocalizedString} */ (`${i?.page}, manutenção iniciada: ${i?.title}`);
		if (i?.part === "maintenance_ended_subject") return /** @type {LocalizedString} */ (`${i?.page}, manutenção concluída: ${i?.title}`);
		if (i?.part === "maintenance_cancelled_subject") return /** @type {LocalizedString} */ (`${i?.page}, manutenção cancelada: ${i?.title}`);
		if (i?.part === "status") return /** @type {LocalizedString} */ (`Status: ${i?.status}`);
		if (i?.part === "affects") return /** @type {LocalizedString} */ (`Afeta ${i?.list}`);
		if (i?.part === "window") return /** @type {LocalizedString} */ (`De ${i?.time} a ${i?.until} UTC`);
		if (i?.part === "started") return /** @type {LocalizedString} */ (`A manutenção começou. A previsão de término é ${i?.until} UTC.`);
		if (i?.part === "ended") return /** @type {LocalizedString} */ (`A manutenção terminou.`);
		if (i?.part === "cancelled") return /** @type {LocalizedString} */ (`Esta manutenção não vai acontecer.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Ver a página de status`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Você recebeu este email porque se inscreveu nas atualizações de ${i?.page}.`);
		if (i?.part === "manage") return /** @type {LocalizedString} */ (`Gerenciar inscrição`);
		if (i?.part === "unsubscribe") return /** @type {LocalizedString} */ (`Cancelar inscrição`);
		return /** @type {LocalizedString} */ (`${i?.page}`)
	}
	{
		if (i?.part === "confirm_subject") return /** @type {LocalizedString} */ (`Confirm your subscription to ${i?.page}`);
		if (i?.part === "confirm_intro") return /** @type {LocalizedString} */ (`Someone, hopefully you, asked for email updates from the ${i?.page} status page at this address.`);
		if (i?.part === "confirm_open") return /** @type {LocalizedString} */ (`Confirm subscription`);
		if (i?.part === "confirm_after") return /** @type {LocalizedString} */ (`The link expires in 48 hours. If you didn't ask for this, ignore this email: you won't get anything else.`);
		if (i?.part === "confirm_footer") return /** @type {LocalizedString} */ (`You get this email because this address was entered on the ${i?.page} status page.`);
		if (i?.part === "incident_created_subject") return /** @type {LocalizedString} */ (`${i?.page}: ${i?.title}`);
		if (i?.part === "incident_updated_subject") return /** @type {LocalizedString} */ (`${i?.page} update: ${i?.title}`);
		if (i?.part === "incident_resolved_subject") return /** @type {LocalizedString} */ (`${i?.page} resolved: ${i?.title}`);
		if (i?.part === "maintenance_scheduled_subject") return /** @type {LocalizedString} */ (`${i?.page} scheduled maintenance: ${i?.title}`);
		if (i?.part === "maintenance_started_subject") return /** @type {LocalizedString} */ (`${i?.page} maintenance started: ${i?.title}`);
		if (i?.part === "maintenance_ended_subject") return /** @type {LocalizedString} */ (`${i?.page} maintenance completed: ${i?.title}`);
		if (i?.part === "maintenance_cancelled_subject") return /** @type {LocalizedString} */ (`${i?.page} maintenance called off: ${i?.title}`);
		if (i?.part === "status") return /** @type {LocalizedString} */ (`Status: ${i?.status}`);
		if (i?.part === "affects") return /** @type {LocalizedString} */ (`Affects ${i?.list}`);
		if (i?.part === "window") return /** @type {LocalizedString} */ (`${i?.time} to ${i?.until} UTC`);
		if (i?.part === "started") return /** @type {LocalizedString} */ (`The maintenance has started. It's planned to end ${i?.until} UTC.`);
		if (i?.part === "ended") return /** @type {LocalizedString} */ (`The maintenance is over.`);
		if (i?.part === "cancelled") return /** @type {LocalizedString} */ (`This maintenance won't happen.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`View the status page`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`You get this email because you subscribed to updates from ${i?.page}.`);
		if (i?.part === "manage") return /** @type {LocalizedString} */ (`Manage your subscription`);
		if (i?.part === "unsubscribe") return /** @type {LocalizedString} */ (`Unsubscribe`);
		return /** @type {LocalizedString} */ (`${i?.page}`)
	}
});