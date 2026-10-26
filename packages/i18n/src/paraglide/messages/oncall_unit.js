/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ unit: NonNullable<unknown> }} Oncall_UnitInputs */



/**
* | unit | output |
* | --- | --- |
* | "hours" | "Hours" |
* | "days" | "Days" |
* | * | "Weeks" |
*
* @param {Oncall_UnitInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_unit = /** @type {((inputs: Oncall_UnitInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_UnitInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.unit === "hours") return /** @type {LocalizedString} */ (`Horas`);
		if (i?.unit === "days") return /** @type {LocalizedString} */ (`Dias`);
		return /** @type {LocalizedString} */ (`Semanas`)
	}
	{
		if (i?.unit === "hours") return /** @type {LocalizedString} */ (`Hours`);
		if (i?.unit === "days") return /** @type {LocalizedString} */ (`Days`);
		return /** @type {LocalizedString} */ (`Weeks`)
	}
});