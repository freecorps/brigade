/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, from: NonNullable<unknown>, to: NonNullable<unknown> }} Overview_CoverInputs */



/**
* | part | output |
* | --- | --- |
* | "now_title" | "On call now" |
* | "all_schedules" | "All schedules" |
* | "cover_title" | "The next 24 hours" |
* | "cover_description" | "Who each schedule pages, from now on. A hatched stretch has nobody on call." |
* | "now" | "Now" |
* | "segment" | "{name}, {from} to {to}" |
* | "set_up" | "Set up on call" |
* | * | "Brigade" |
*
* @param {Overview_CoverInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const overview_cover = /** @type {((inputs: Overview_CoverInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_CoverInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "now_title") return /** @type {LocalizedString} */ (`Plantão agora`);
		if (i?.part === "all_schedules") return /** @type {LocalizedString} */ (`Todas as escalas`);
		if (i?.part === "cover_title") return /** @type {LocalizedString} */ (`As próximas 24 horas`);
		if (i?.part === "cover_description") return /** @type {LocalizedString} */ (`Quem cada escala aciona, a partir de agora. Um trecho hachurado não tem ninguém de plantão.`);
		if (i?.part === "now") return /** @type {LocalizedString} */ (`Agora`);
		if (i?.part === "segment") return /** @type {LocalizedString} */ (`${i?.name}, de ${i?.from} a ${i?.to}`);
		if (i?.part === "set_up") return /** @type {LocalizedString} */ (`Configurar o plantão`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "now_title") return /** @type {LocalizedString} */ (`On call now`);
		if (i?.part === "all_schedules") return /** @type {LocalizedString} */ (`All schedules`);
		if (i?.part === "cover_title") return /** @type {LocalizedString} */ (`The next 24 hours`);
		if (i?.part === "cover_description") return /** @type {LocalizedString} */ (`Who each schedule pages, from now on. A hatched stretch has nobody on call.`);
		if (i?.part === "now") return /** @type {LocalizedString} */ (`Now`);
		if (i?.part === "segment") return /** @type {LocalizedString} */ (`${i?.name}, ${i?.from} to ${i?.to}`);
		if (i?.part === "set_up") return /** @type {LocalizedString} */ (`Set up on call`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});