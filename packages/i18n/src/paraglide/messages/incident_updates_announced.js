/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Incident_Updates_AnnouncedInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "1 new update from others" |
* | * | "{countFormatted} new updates from others" |
*
* @param {Incident_Updates_AnnouncedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_updates_announced = /** @type {((inputs: Incident_Updates_AnnouncedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Updates_AnnouncedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`1 nova atualização de outras pessoas`);
		return /** @type {LocalizedString} */ (`${countFormatted} novas atualizações de outras pessoas`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`1 new update from others`);
		return /** @type {LocalizedString} */ (`${countFormatted} new updates from others`)
	}
});