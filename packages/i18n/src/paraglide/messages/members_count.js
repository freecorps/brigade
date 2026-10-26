/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Members_CountInputs */



/**
* | countExact | countPlural | output |
* | --- | --- | --- |
* | "0" | * | "No members" |
* | * | "one" | "{countFormatted} member" |
* | * | * | "{countFormatted} members" |
*
* @param {Members_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const members_count = /** @type {((inputs: Members_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countExact = i?.count;
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`Nenhum membro`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} membro`);
		return /** @type {LocalizedString} */ (`${countFormatted} membros`)
	}
	{
		const countExact = i?.count;
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if ((countExact === 0 || countExact === "0")) return /** @type {LocalizedString} */ (`No members`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} member`);
		return /** @type {LocalizedString} */ (`${countFormatted} members`)
	}
});