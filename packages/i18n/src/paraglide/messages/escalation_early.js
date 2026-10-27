/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, from: NonNullable<unknown>, level: NonNullable<unknown>, who: NonNullable<unknown> }} Escalation_EarlyInputs */



/**
* | kind | output |
* | --- | --- |
* | "level" | "Nobody on level {from} could be reached, so level {level} was paged now: {who}" |
* | * | "Nobody on level {from} could be reached and no level is left, so everyone who can respond was paged now" |
*
* @param {Escalation_EarlyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_early = /** @type {((inputs: Escalation_EarlyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_EarlyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "level") return /** @type {LocalizedString} */ (`Ninguém no nível ${i?.from} pôde ser alcançado, então o nível ${i?.level} foi chamado na hora: ${i?.who}`);
		return /** @type {LocalizedString} */ (`Ninguém no nível ${i?.from} pôde ser alcançado e não há outro nível, então todos que podem responder foram chamados na hora`)
	}
	{
		if (i?.kind === "level") return /** @type {LocalizedString} */ (`Nobody on level ${i?.from} could be reached, so level ${i?.level} was paged now: ${i?.who}`);
		return /** @type {LocalizedString} */ (`Nobody on level ${i?.from} could be reached and no level is left, so everyone who can respond was paged now`)
	}
});