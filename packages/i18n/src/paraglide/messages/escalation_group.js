/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ group: NonNullable<unknown> }} Escalation_GroupInputs */



/**
* | group | output |
* | --- | --- |
* | "schedules" | "Schedules (whoever is on call)" |
* | "people" | "People" |
* | * | "Targets" |
*
* @param {Escalation_GroupInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_group = /** @type {((inputs: Escalation_GroupInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_GroupInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.group === "schedules") return /** @type {LocalizedString} */ (`Escalas (quem estiver de plantão)`);
		if (i?.group === "people") return /** @type {LocalizedString} */ (`Pessoas`);
		return /** @type {LocalizedString} */ (`Destinos`)
	}
	{
		if (i?.group === "schedules") return /** @type {LocalizedString} */ (`Schedules (whoever is on call)`);
		if (i?.group === "people") return /** @type {LocalizedString} */ (`People`);
		return /** @type {LocalizedString} */ (`Targets`)
	}
});