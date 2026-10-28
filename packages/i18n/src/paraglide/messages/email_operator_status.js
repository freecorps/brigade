/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Email_Operator_StatusInputs */



/**
* | part | output |
* | --- | --- |
* | "subject_degraded" | "Brigade's paging self-check is degraded" |
* | "subject_ok" | "Brigade's paging self-check is back to normal" |
* | "subject_unknown" | "Brigade's paging self-check changed" |
* | "intro_degraded" | "The paging self-check of this Brigade instance found a problem. Pages may be late or may not go out until it's fixed:" |
* | "intro_ok" | "The paging self-check of this Brigade instance is passing again: a heartbeat went through the event queue and the push relay." |
* | "intro_unknown" | "The paging self-check of this Brigade instance has no result yet." |
* | "how" | "The Worker's logs have the details (search for \"paging pipeline\"). GET /health/paging shows the state as members see it." |
* | "footer" | "You get this email because your address is in OPERATOR_EMAILS for this Brigade instance." |
* | * | "Brigade's paging self-check changed" |
*
* @param {Email_Operator_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_operator_status = /** @type {((inputs: Email_Operator_StatusInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Operator_StatusInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject_degraded") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos do Brigade está degradada`);
		if (i?.part === "subject_ok") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos do Brigade voltou ao normal`);
		if (i?.part === "subject_unknown") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos do Brigade mudou`);
		if (i?.part === "intro_degraded") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos desta instância do Brigade encontrou um problema. Os acionamentos podem atrasar ou não sair até que seja corrigido:`);
		if (i?.part === "intro_ok") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos desta instância do Brigade voltou a passar: um sinal passou pela fila de eventos e pelo relay de push.`);
		if (i?.part === "intro_unknown") return /** @type {LocalizedString} */ (`A autoverificação de acionamentos desta instância do Brigade ainda não tem resultado.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`Os logs do Worker têm os detalhes (procure por "paging pipeline"). GET /health/paging mostra o estado como os membros o veem.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Você recebe este email porque seu endereço está em OPERATOR_EMAILS nesta instância do Brigade.`);
		return /** @type {LocalizedString} */ (`A autoverificação de acionamentos do Brigade mudou`)
	}
	{
		if (i?.part === "subject_degraded") return /** @type {LocalizedString} */ (`Brigade's paging self-check is degraded`);
		if (i?.part === "subject_ok") return /** @type {LocalizedString} */ (`Brigade's paging self-check is back to normal`);
		if (i?.part === "subject_unknown") return /** @type {LocalizedString} */ (`Brigade's paging self-check changed`);
		if (i?.part === "intro_degraded") return /** @type {LocalizedString} */ (`The paging self-check of this Brigade instance found a problem. Pages may be late or may not go out until it's fixed:`);
		if (i?.part === "intro_ok") return /** @type {LocalizedString} */ (`The paging self-check of this Brigade instance is passing again: a heartbeat went through the event queue and the push relay.`);
		if (i?.part === "intro_unknown") return /** @type {LocalizedString} */ (`The paging self-check of this Brigade instance has no result yet.`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`The Worker's logs have the details (search for "paging pipeline"). GET /health/paging shows the state as members see it.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`You get this email because your address is in OPERATOR_EMAILS for this Brigade instance.`);
		return /** @type {LocalizedString} */ (`Brigade's paging self-check changed`)
	}
});