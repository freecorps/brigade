/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ unit: NonNullable<unknown>, day: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_HandoffInputs */



/**
* | unit | output |
* | --- | --- |
* | "weeks" | "hands off {day} at {time}" |
* | * | "hands off at {time}" |
*
* @param {Oncall_HandoffInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_handoff = /** @type {((inputs: Oncall_HandoffInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_HandoffInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.unit === "weeks") return /** @type {LocalizedString} */ (`troca ${i?.day}, às ${i?.time}`);
		return /** @type {LocalizedString} */ (`troca às ${i?.time}`)
	}
	{
		if (i?.unit === "weeks") return /** @type {LocalizedString} */ (`hands off ${i?.day} at ${i?.time}`);
		return /** @type {LocalizedString} */ (`hands off at ${i?.time}`)
	}
});