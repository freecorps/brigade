/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ unit: NonNullable<unknown>, count: NonNullable<unknown> }} Oncall_Shift_LengthInputs */



/**
* | unit | countPlural | output |
* | --- | --- | --- |
* | "hours" | "one" | "Every hour" |
* | "hours" | * | "Every {count} hours" |
* | "days" | "one" | "Daily" |
* | "days" | * | "Every {count} days" |
* | "weeks" | "one" | "Weekly" |
* | * | * | "Every {count} weeks" |
*
* @param {Oncall_Shift_LengthInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_shift_length = /** @type {((inputs: Oncall_Shift_LengthInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Shift_LengthInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		if (i?.unit === "hours" && countPlural === "one") return /** @type {LocalizedString} */ (`A cada hora`);
		if (i?.unit === "days" && countPlural === "one") return /** @type {LocalizedString} */ (`Diário`);
		if (i?.unit === "weeks" && countPlural === "one") return /** @type {LocalizedString} */ (`Semanal`);
		if (i?.unit === "hours") return /** @type {LocalizedString} */ (`A cada ${i?.count} horas`);
		if (i?.unit === "days") return /** @type {LocalizedString} */ (`A cada ${i?.count} dias`);
		return /** @type {LocalizedString} */ (`A cada ${i?.count} semanas`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		if (i?.unit === "hours" && countPlural === "one") return /** @type {LocalizedString} */ (`Every hour`);
		if (i?.unit === "days" && countPlural === "one") return /** @type {LocalizedString} */ (`Daily`);
		if (i?.unit === "weeks" && countPlural === "one") return /** @type {LocalizedString} */ (`Weekly`);
		if (i?.unit === "hours") return /** @type {LocalizedString} */ (`Every ${i?.count} hours`);
		if (i?.unit === "days") return /** @type {LocalizedString} */ (`Every ${i?.count} days`);
		return /** @type {LocalizedString} */ (`Every ${i?.count} weeks`)
	}
});