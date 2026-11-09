/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ days: NonNullable<unknown> }} Incidents_Past_EmptyInputs */



/**
* | output |
* | --- |
* | "No incident was resolved or declined in the last {days} days." |
*
* @param {Incidents_Past_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_past_empty = /** @type {((inputs: Incidents_Past_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Nenhum incidente foi resolvido ou recusado nos últimos ${i?.days} dias.`)
	return /** @type {LocalizedString} */ (`No incident was resolved or declined in the last ${i?.days} days.`)
});