/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ error: NonNullable<unknown>, status: NonNullable<unknown> }} Webhook_ErrorInputs */



/**
* | error | output |
* | --- | --- |
* | "timeout" | "Timed out" |
* | "network" | "Couldn't connect" |
* | "status" | "HTTP {status}" |
* | "redirect" | "Redirect {status}, not followed" |
* | "blocked" | "Blocked: not a public https URL" |
* | "secret" | "Secret unreadable on the server" |
* | * | "Timed out" |
*
* @param {Webhook_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const webhook_error = /** @type {((inputs: Webhook_ErrorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Webhook_ErrorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.error === "timeout") return /** @type {LocalizedString} */ (`Tempo esgotado`);
		if (i?.error === "network") return /** @type {LocalizedString} */ (`Não conectou`);
		if (i?.error === "status") return /** @type {LocalizedString} */ (`HTTP ${i?.status}`);
		if (i?.error === "redirect") return /** @type {LocalizedString} */ (`Redirecionamento ${i?.status}, não seguido`);
		if (i?.error === "blocked") return /** @type {LocalizedString} */ (`Bloqueado: não é uma URL https pública`);
		if (i?.error === "secret") return /** @type {LocalizedString} */ (`Segredo ilegível no servidor`);
		return /** @type {LocalizedString} */ (`Tempo esgotado`)
	}
	{
		if (i?.error === "timeout") return /** @type {LocalizedString} */ (`Timed out`);
		if (i?.error === "network") return /** @type {LocalizedString} */ (`Couldn't connect`);
		if (i?.error === "status") return /** @type {LocalizedString} */ (`HTTP ${i?.status}`);
		if (i?.error === "redirect") return /** @type {LocalizedString} */ (`Redirect ${i?.status}, not followed`);
		if (i?.error === "blocked") return /** @type {LocalizedString} */ (`Blocked: not a public https URL`);
		if (i?.error === "secret") return /** @type {LocalizedString} */ (`Secret unreadable on the server`);
		return /** @type {LocalizedString} */ (`Timed out`)
	}
});