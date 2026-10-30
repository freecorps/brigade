/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ host: NonNullable<unknown> }} Incident_Open_LinkInputs */



/**
* | output |
* | --- |
* | "Open {host}" |
*
* @param {Incident_Open_LinkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_open_link = /** @type {((inputs: Incident_Open_LinkInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Open_LinkInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Abrir ${i?.host}`)
	return /** @type {LocalizedString} */ (`Open ${i?.host}`)
});