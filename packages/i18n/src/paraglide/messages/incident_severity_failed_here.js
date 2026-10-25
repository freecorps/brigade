/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ severity: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Severity_Failed_HereInputs */



/**
* | output |
* | --- |
* | "Couldn't change it to {severity}. {reason}" |
*
* @param {Incident_Severity_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_severity_failed_here = /** @type {((inputs: Incident_Severity_Failed_HereInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Severity_Failed_HereInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível mudar para ${i?.severity}. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't change it to ${i?.severity}. ${i?.reason}`)
});