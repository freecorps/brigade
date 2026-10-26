/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_AckInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Acknowledge" |
* | "hint" | "Stops paging: no further escalation level fires." |
* | "by" | "Acknowledged by {name}, {time}" |
* | "already" | "Someone else acknowledged it first." |
* | "failed" | "Couldn't acknowledge it. {reason}" |
* | * | "Acknowledge" |
*
* @param {Incident_AckInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_ack = /** @type {((inputs: Incident_AckInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_AckInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Confirmar`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Para as chamadas: nenhum outro nível de escalonamento é disparado.`);
		if (i?.part === "by") return /** @type {LocalizedString} */ (`Confirmado por ${i?.name}, ${i?.time}`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Outra pessoa confirmou primeiro.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível confirmar. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Confirmar`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Acknowledge`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Stops paging: no further escalation level fires.`);
		if (i?.part === "by") return /** @type {LocalizedString} */ (`Acknowledged by ${i?.name}, ${i?.time}`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Someone else acknowledged it first.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't acknowledge it. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Acknowledge`)
	}
});