/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Members_Show_AllInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "Show all {countFormatted} member" |
* | * | "Show all {countFormatted} members" |
*
* @param {Members_Show_AllInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const members_show_all = /** @type {((inputs: Members_Show_AllInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_Show_AllInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Mostrar ${countFormatted} membro`);
		return /** @type {LocalizedString} */ (`Mostrar todos os ${countFormatted} membros`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Show all ${countFormatted} member`);
		return /** @type {LocalizedString} */ (`Show all ${countFormatted} members`)
	}
});