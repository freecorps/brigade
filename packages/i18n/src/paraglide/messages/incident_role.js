/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ role: NonNullable<unknown> }} Incident_RoleInputs */



/**
* | role | output |
* | --- | --- |
* | "commander" | "Incident commander" |
* | "communications" | "Communications lead" |
* | * | "Operations lead" |
*
* @param {Incident_RoleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_role = /** @type {((inputs: Incident_RoleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_RoleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.role === "commander") return /** @type {LocalizedString} */ (`Comandante do incidente`);
		if (i?.role === "communications") return /** @type {LocalizedString} */ (`Responsável pela comunicação`);
		return /** @type {LocalizedString} */ (`Responsável pelas operações`)
	}
	{
		if (i?.role === "commander") return /** @type {LocalizedString} */ (`Incident commander`);
		if (i?.role === "communications") return /** @type {LocalizedString} */ (`Communications lead`);
		return /** @type {LocalizedString} */ (`Operations lead`)
	}
});