/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ has: NonNullable<unknown>, number: NonNullable<unknown> }} Monitor_Incident_LinkInputs */



/**
* | has | output |
* | --- | --- |
* | "yes" | "Open {number}" |
* | * | "Open incident" |
*
* @param {Monitor_Incident_LinkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_incident_link = /** @type {((inputs: Monitor_Incident_LinkInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Incident_LinkInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.has === "yes") return /** @type {LocalizedString} */ (`Abrir ${i?.number}`);
		return /** @type {LocalizedString} */ (`Abrir incidente`)
	}
	{
		if (i?.has === "yes") return /** @type {LocalizedString} */ (`Open ${i?.number}`);
		return /** @type {LocalizedString} */ (`Open incident`)
	}
});