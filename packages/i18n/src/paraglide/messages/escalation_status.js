/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ status: NonNullable<unknown>, time: NonNullable<unknown> }} Escalation_StatusInputs */



/**
* | status | output |
* | --- | --- |
* | "running" | "Escalating" |
* | "acknowledged" | "Stopped: acknowledged {time}" |
* | "resolved" | "Stopped: resolved {time}" |
* | "exhausted" | "Nobody acknowledged: no levels left since {time}" |
* | * | "Escalation" |
*
* @param {Escalation_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_status = /** @type {((inputs: Escalation_StatusInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_StatusInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.status === "running") return /** @type {LocalizedString} */ (`Escalonando`);
		if (i?.status === "acknowledged") return /** @type {LocalizedString} */ (`Parado: confirmado ${i?.time}`);
		if (i?.status === "resolved") return /** @type {LocalizedString} */ (`Parado: resolvido ${i?.time}`);
		if (i?.status === "exhausted") return /** @type {LocalizedString} */ (`Ninguém confirmou: sem níveis restantes desde ${i?.time}`);
		return /** @type {LocalizedString} */ (`Escalonamento`)
	}
	{
		if (i?.status === "running") return /** @type {LocalizedString} */ (`Escalating`);
		if (i?.status === "acknowledged") return /** @type {LocalizedString} */ (`Stopped: acknowledged ${i?.time}`);
		if (i?.status === "resolved") return /** @type {LocalizedString} */ (`Stopped: resolved ${i?.time}`);
		if (i?.status === "exhausted") return /** @type {LocalizedString} */ (`Nobody acknowledged: no levels left since ${i?.time}`);
		return /** @type {LocalizedString} */ (`Escalation`)
	}
});