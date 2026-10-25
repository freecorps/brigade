/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ role: NonNullable<unknown>, form: NonNullable<unknown> }} Incident_RoleInputs */



/**
* | role | form | output |
* | --- | --- | --- |
* | "commander" | "sentence" | "incident commander" |
* | "communications" | "sentence" | "communications lead" |
* | "operations" | "sentence" | "operations lead" |
* | "commander" | * | "Incident commander" |
* | "communications" | * | "Communications lead" |
* | "operations" | * | "Operations lead" |
* | * | * | "Role" |
*
* @param {Incident_RoleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_role = /** @type {((inputs: Incident_RoleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_RoleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.role === "commander" && i?.form === "sentence") return /** @type {LocalizedString} */ (`comandante do incidente`);
		if (i?.role === "communications" && i?.form === "sentence") return /** @type {LocalizedString} */ (`responsável pela comunicação`);
		if (i?.role === "operations" && i?.form === "sentence") return /** @type {LocalizedString} */ (`responsável pelas operações`);
		if (i?.role === "commander") return /** @type {LocalizedString} */ (`Comandante do incidente`);
		if (i?.role === "communications") return /** @type {LocalizedString} */ (`Responsável pela comunicação`);
		if (i?.role === "operations") return /** @type {LocalizedString} */ (`Responsável pelas operações`);
		return /** @type {LocalizedString} */ (`Papel`)
	}
	{
		if (i?.role === "commander" && i?.form === "sentence") return /** @type {LocalizedString} */ (`incident commander`);
		if (i?.role === "communications" && i?.form === "sentence") return /** @type {LocalizedString} */ (`communications lead`);
		if (i?.role === "operations" && i?.form === "sentence") return /** @type {LocalizedString} */ (`operations lead`);
		if (i?.role === "commander") return /** @type {LocalizedString} */ (`Incident commander`);
		if (i?.role === "communications") return /** @type {LocalizedString} */ (`Communications lead`);
		if (i?.role === "operations") return /** @type {LocalizedString} */ (`Operations lead`);
		return /** @type {LocalizedString} */ (`Role`)
	}
});