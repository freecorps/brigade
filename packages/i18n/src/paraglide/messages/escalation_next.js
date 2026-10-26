/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, level: NonNullable<unknown>, time: NonNullable<unknown> }} Escalation_NextInputs */



/**
* | kind | output |
* | --- | --- |
* | "level" | "Level {level} {time}" |
* | "repeat" | "Level 1 again {time}" |
* | "end" | "Gives up {time}" |
* | * | "{time}" |
*
* @param {Escalation_NextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_next = /** @type {((inputs: Escalation_NextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_NextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "level") return /** @type {LocalizedString} */ (`Nível ${i?.level} ${i?.time}`);
		if (i?.kind === "repeat") return /** @type {LocalizedString} */ (`Nível 1 de novo ${i?.time}`);
		if (i?.kind === "end") return /** @type {LocalizedString} */ (`Desiste ${i?.time}`);
		return /** @type {LocalizedString} */ (`${i?.time}`)
	}
	{
		if (i?.kind === "level") return /** @type {LocalizedString} */ (`Level ${i?.level} ${i?.time}`);
		if (i?.kind === "repeat") return /** @type {LocalizedString} */ (`Level 1 again ${i?.time}`);
		if (i?.kind === "end") return /** @type {LocalizedString} */ (`Gives up ${i?.time}`);
		return /** @type {LocalizedString} */ (`${i?.time}`)
	}
});