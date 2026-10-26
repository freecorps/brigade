/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, level: NonNullable<unknown> }} Escalation_ProgressInputs */



/**
* | part | output |
* | --- | --- |
* | "running" | "Escalating" |
* | "acknowledged" | "Stopped: acknowledged {time}" |
* | "resolved" | "Stopped: resolved {time}" |
* | "exhausted" | "Nobody acknowledged: no levels left since {time}" |
* | "next_level" | "Level {level} {time}" |
* | "next_repeat" | "Level 1 again {time}" |
* | "next_end" | "Gives up {time}" |
* | * | "Escalation" |
*
* @param {Escalation_ProgressInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_progress = /** @type {((inputs: Escalation_ProgressInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_ProgressInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "running") return /** @type {LocalizedString} */ (`Escalonando`);
		if (i?.part === "acknowledged") return /** @type {LocalizedString} */ (`Parado: confirmado ${i?.time}`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`Parado: resolvido ${i?.time}`);
		if (i?.part === "exhausted") return /** @type {LocalizedString} */ (`Ninguém confirmou: sem níveis restantes desde ${i?.time}`);
		if (i?.part === "next_level") return /** @type {LocalizedString} */ (`Nível ${i?.level} ${i?.time}`);
		if (i?.part === "next_repeat") return /** @type {LocalizedString} */ (`Nível 1 de novo ${i?.time}`);
		if (i?.part === "next_end") return /** @type {LocalizedString} */ (`Desiste ${i?.time}`);
		return /** @type {LocalizedString} */ (`Escalonamento`)
	}
	{
		if (i?.part === "running") return /** @type {LocalizedString} */ (`Escalating`);
		if (i?.part === "acknowledged") return /** @type {LocalizedString} */ (`Stopped: acknowledged ${i?.time}`);
		if (i?.part === "resolved") return /** @type {LocalizedString} */ (`Stopped: resolved ${i?.time}`);
		if (i?.part === "exhausted") return /** @type {LocalizedString} */ (`Nobody acknowledged: no levels left since ${i?.time}`);
		if (i?.part === "next_level") return /** @type {LocalizedString} */ (`Level ${i?.level} ${i?.time}`);
		if (i?.part === "next_repeat") return /** @type {LocalizedString} */ (`Level 1 again ${i?.time}`);
		if (i?.part === "next_end") return /** @type {LocalizedString} */ (`Gives up ${i?.time}`);
		return /** @type {LocalizedString} */ (`Escalation`)
	}
});