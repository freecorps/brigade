/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, name: NonNullable<unknown> }} Escalation_MissInputs */



/**
* | reason | output |
* | --- | --- |
* | "no_devices" | "{name} (no phone registered)" |
* | "nobody_on_call" | "{name} (nobody on call)" |
* | "schedule_missing" | "A deleted schedule" |
* | "not_a_member" | "{name} (can no longer respond)" |
* | "failed" | "{name} (push failed)" |
* | * | "{name}" |
*
* @param {Escalation_MissInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_miss = /** @type {((inputs: Escalation_MissInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_MissInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.reason === "no_devices") return /** @type {LocalizedString} */ (`${i?.name} (sem celular registrado)`);
		if (i?.reason === "nobody_on_call") return /** @type {LocalizedString} */ (`${i?.name} (ninguém de plantão)`);
		if (i?.reason === "schedule_missing") return /** @type {LocalizedString} */ (`Uma escala excluída`);
		if (i?.reason === "not_a_member") return /** @type {LocalizedString} */ (`${i?.name} (não pode mais responder)`);
		if (i?.reason === "failed") return /** @type {LocalizedString} */ (`${i?.name} (falha no envio)`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
	{
		if (i?.reason === "no_devices") return /** @type {LocalizedString} */ (`${i?.name} (no phone registered)`);
		if (i?.reason === "nobody_on_call") return /** @type {LocalizedString} */ (`${i?.name} (nobody on call)`);
		if (i?.reason === "schedule_missing") return /** @type {LocalizedString} */ (`A deleted schedule`);
		if (i?.reason === "not_a_member") return /** @type {LocalizedString} */ (`${i?.name} (can no longer respond)`);
		if (i?.reason === "failed") return /** @type {LocalizedString} */ (`${i?.name} (push failed)`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
});