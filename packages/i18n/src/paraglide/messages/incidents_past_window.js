/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ days: NonNullable<unknown> }} Incidents_Past_WindowInputs */



/**
* | output |
* | --- |
* | "Resolved or declined, declared in the last {days} days" |
*
* @param {Incidents_Past_WindowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incidents_past_window = /** @type {((inputs: Incidents_Past_WindowInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incidents_Past_WindowInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Resolvidos ou recusados, declarados nos últimos ${i?.days} dias`)
	return /** @type {LocalizedString} */ (`Resolved or declined, declared in the last ${i?.days} days`)
});