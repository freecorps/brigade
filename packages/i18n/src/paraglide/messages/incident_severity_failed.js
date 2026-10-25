/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ incident: NonNullable<unknown>, severity: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Severity_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't change {incident} to {severity}. {reason}" |
*
* @param {Incident_Severity_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_severity_failed = /** @type {((inputs: Incident_Severity_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Severity_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível mudar ${i?.incident} para ${i?.severity}. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't change ${i?.incident} to ${i?.severity}. ${i?.reason}`)
});