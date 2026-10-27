/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, confirmed: NonNullable<unknown>, pending: NonNullable<unknown>, email: NonNullable<unknown> }} Status_SubscribersInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Email subscribers" |
* | "hint" | "Visitors subscribe on the public page and confirm by email. Only owners and admins see this, and addresses never appear on the page." |
* | "count" | "{confirmed} confirmed, {pending} waiting to confirm" |
* | "load_failed" | "Couldn't load the subscribers." |
* | "retry" | "Try again" |
* | "export" | "Export CSV" |
* | "remove_label" | "Remove a subscriber" |
* | "remove_hint" | "Their address. They get no email about it." |
* | "remove" | "Remove" |
* | "removing" | "Removing…" |
* | "removed" | "Removed {email}." |
* | "not_found" | "No subscriber has that address." |
* | "remove_failed" | "Couldn't remove. Try again." |
* | * | "Subscribers" |
*
* @param {Status_SubscribersInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_subscribers = /** @type {((inputs: Status_SubscribersInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_SubscribersInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Inscritos por email`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Visitantes se inscrevem na página pública e confirmam por email. Só owners e admins veem isto, e os endereços nunca aparecem na página.`);
		if (i?.part === "count") return /** @type {LocalizedString} */ (`${i?.confirmed} confirmados, ${i?.pending} aguardando confirmação`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar os inscritos.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "export") return /** @type {LocalizedString} */ (`Exportar CSV`);
		if (i?.part === "remove_label") return /** @type {LocalizedString} */ (`Remover um inscrito`);
		if (i?.part === "remove_hint") return /** @type {LocalizedString} */ (`O endereço da pessoa. Ela não recebe email sobre isso.`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removendo…`);
		if (i?.part === "removed") return /** @type {LocalizedString} */ (`${i?.email} foi removido.`);
		if (i?.part === "not_found") return /** @type {LocalizedString} */ (`Nenhum inscrito tem esse endereço.`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Não foi possível remover. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Inscritos`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Email subscribers`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Visitors subscribe on the public page and confirm by email. Only owners and admins see this, and addresses never appear on the page.`);
		if (i?.part === "count") return /** @type {LocalizedString} */ (`${i?.confirmed} confirmed, ${i?.pending} waiting to confirm`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the subscribers.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "export") return /** @type {LocalizedString} */ (`Export CSV`);
		if (i?.part === "remove_label") return /** @type {LocalizedString} */ (`Remove a subscriber`);
		if (i?.part === "remove_hint") return /** @type {LocalizedString} */ (`Their address. They get no email about it.`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removing…`);
		if (i?.part === "removed") return /** @type {LocalizedString} */ (`Removed ${i?.email}.`);
		if (i?.part === "not_found") return /** @type {LocalizedString} */ (`No subscriber has that address.`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Couldn't remove. Try again.`);
		return /** @type {LocalizedString} */ (`Subscribers`)
	}
});