/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ incident: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Change_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't update {incident}. {reason}" |
*
* @param {Incident_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_change_failed = /** @type {((inputs: Incident_Change_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Change_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível atualizar ${i?.incident}. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't update ${i?.incident}. ${i?.reason}`)
});