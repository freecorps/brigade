/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown> }} Escalation_TargetInputs */



/**
* | kind | output |
* | --- | --- |
* | "schedule" | "Schedule" |
* | "member" | "Person" |
* | * | "Target" |
*
* @param {Escalation_TargetInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_target = /** @type {((inputs: Escalation_TargetInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_TargetInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "schedule") return /** @type {LocalizedString} */ (`Escala`);
		if (i?.kind === "member") return /** @type {LocalizedString} */ (`Pessoa`);
		return /** @type {LocalizedString} */ (`Destino`)
	}
	{
		if (i?.kind === "schedule") return /** @type {LocalizedString} */ (`Schedule`);
		if (i?.kind === "member") return /** @type {LocalizedString} */ (`Person`);
		return /** @type {LocalizedString} */ (`Target`)
	}
});