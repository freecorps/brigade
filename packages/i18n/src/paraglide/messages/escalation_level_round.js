/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ level: NonNullable<unknown>, round: NonNullable<unknown> }} Escalation_Level_RoundInputs */



/**
* | round | output |
* | --- | --- |
* | "0" | "{level}" |
* | * | "{level} (repeat {round})" |
*
* @param {Escalation_Level_RoundInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_level_round = /** @type {((inputs: Escalation_Level_RoundInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Level_RoundInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if ((i?.round === 0 || i?.round === "0")) return /** @type {LocalizedString} */ (`${i?.level}`);
		return /** @type {LocalizedString} */ (`${i?.level} (repetição ${i?.round})`)
	}
	{
		if ((i?.round === 0 || i?.round === "0")) return /** @type {LocalizedString} */ (`${i?.level}`);
		return /** @type {LocalizedString} */ (`${i?.level} (repeat ${i?.round})`)
	}
});