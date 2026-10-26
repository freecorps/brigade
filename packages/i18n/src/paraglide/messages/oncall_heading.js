/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ heading: NonNullable<unknown> }} Oncall_HeadingInputs */



/**
* | heading | output |
* | --- | --- |
* | "new" | "New schedule" |
* | "layers" | "Layers" |
* | "overrides" | "Overrides" |
* | "now" | "On call now" |
* | * | "Next handoffs" |
*
* @param {Oncall_HeadingInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_heading = /** @type {((inputs: Oncall_HeadingInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_HeadingInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.heading === "new") return /** @type {LocalizedString} */ (`Nova escala`);
		if (i?.heading === "layers") return /** @type {LocalizedString} */ (`Camadas`);
		if (i?.heading === "overrides") return /** @type {LocalizedString} */ (`Substituições`);
		if (i?.heading === "now") return /** @type {LocalizedString} */ (`De plantão agora`);
		return /** @type {LocalizedString} */ (`Próximas trocas`)
	}
	{
		if (i?.heading === "new") return /** @type {LocalizedString} */ (`New schedule`);
		if (i?.heading === "layers") return /** @type {LocalizedString} */ (`Layers`);
		if (i?.heading === "overrides") return /** @type {LocalizedString} */ (`Overrides`);
		if (i?.heading === "now") return /** @type {LocalizedString} */ (`On call now`);
		return /** @type {LocalizedString} */ (`Next handoffs`)
	}
});