/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ level: NonNullable<unknown> }} Escalation_LevelInputs */



/**
* | output |
* | --- |
* | "Level {level}" |
*
* @param {Escalation_LevelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_level = /** @type {((inputs: Escalation_LevelInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_LevelInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Nível ${i?.level}`)
	return /** @type {LocalizedString} */ (`Level ${i?.level}`)
});