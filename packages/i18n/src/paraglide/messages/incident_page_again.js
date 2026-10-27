/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Page_AgainInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Page again" |
* | "pending" | "Paging again…" |
* | "already" | "This was already paged again, by someone or by Brigade." |
* | "acked" | "Someone acknowledged the incident, so there's nothing to page again." |
* | "resolved" | "The incident is no longer active, so there's nothing to page again." |
* | "failed" | "Couldn't page again. {reason}" |
* | "confirm_title" | "Page again?" |
* | "confirm_body" | "Brigade sends a new page to everyone this one missed, right now." |
* | "done" | "Paged again" |
* | * | "Page again" |
*
* @param {Incident_Page_AgainInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_page_again = /** @type {((inputs: Incident_Page_AgainInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Page_AgainInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Chamar de novo`);
		if (i?.part === "pending") return /** @type {LocalizedString} */ (`Chamando de novo…`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Isso já foi chamado de novo, por alguém ou pelo Brigade.`);
		if (i?.part === "acked") return /** @type {LocalizedString} */ (`Alguém confirmou o incidente, então não há o que chamar de novo.`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`O incidente não está mais ativo, então não há o que chamar de novo.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível chamar de novo. ${i?.reason}`);
		if (i?.part === "confirm_title") return /** @type {LocalizedString} */ (`Chamar de novo?`);
		if (i?.part === "confirm_body") return /** @type {LocalizedString} */ (`O Brigade envia agora um novo acionamento para todos que este não alcançou.`);
		if (i?.part === "done") return /** @type {LocalizedString} */ (`Chamado de novo`);
		return /** @type {LocalizedString} */ (`Chamar de novo`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Page again`);
		if (i?.part === "pending") return /** @type {LocalizedString} */ (`Paging again…`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`This was already paged again, by someone or by Brigade.`);
		if (i?.part === "acked") return /** @type {LocalizedString} */ (`Someone acknowledged the incident, so there's nothing to page again.`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`The incident is no longer active, so there's nothing to page again.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't page again. ${i?.reason}`);
		if (i?.part === "confirm_title") return /** @type {LocalizedString} */ (`Page again?`);
		if (i?.part === "confirm_body") return /** @type {LocalizedString} */ (`Brigade sends a new page to everyone this one missed, right now.`);
		if (i?.part === "done") return /** @type {LocalizedString} */ (`Paged again`);
		return /** @type {LocalizedString} */ (`Page again`)
	}
});