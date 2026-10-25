/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Incidents_Sev1_CountInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "{countFormatted} is SEV1" |
* | * | "{countFormatted} are SEV1" |
*
* @param {Incidents_Sev1_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_sev1_count = /** @type {((inputs: Incidents_Sev1_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Sev1_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} é SEV1`);
		return /** @type {LocalizedString} */ (`${countFormatted} são SEV1`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} is SEV1`);
		return /** @type {LocalizedString} */ (`${countFormatted} are SEV1`)
	}
});