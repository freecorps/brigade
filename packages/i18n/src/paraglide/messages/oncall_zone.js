/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Oncall_ZoneInputs */



/**
* | part | output |
* | --- | --- |
* | "placeholder" | "Search a city or UTC offset" |
* | "empty" | "No time zone matches." |
* | "suggested" | "Suggested" |
* | "yours" | "Your time zone" |
* | * | "All time zones" |
*
* @param {Oncall_ZoneInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_zone = /** @type {((inputs: Oncall_ZoneInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_ZoneInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "placeholder") return /** @type {LocalizedString} */ (`Busque uma cidade ou deslocamento UTC`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhum fuso horário encontrado.`);
		if (i?.part === "suggested") return /** @type {LocalizedString} */ (`Sugestões`);
		if (i?.part === "yours") return /** @type {LocalizedString} */ (`Seu fuso horário`);
		return /** @type {LocalizedString} */ (`Todos os fusos horários`)
	}
	{
		if (i?.part === "placeholder") return /** @type {LocalizedString} */ (`Search a city or UTC offset`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No time zone matches.`);
		if (i?.part === "suggested") return /** @type {LocalizedString} */ (`Suggested`);
		if (i?.part === "yours") return /** @type {LocalizedString} */ (`Your time zone`);
		return /** @type {LocalizedString} */ (`All time zones`)
	}
});