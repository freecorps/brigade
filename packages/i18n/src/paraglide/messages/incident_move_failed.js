/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ incident: NonNullable<unknown>, status: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Move_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't move {incident} to {status}. {reason}" |
*
* @param {Incident_Move_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_move_failed = /** @type {((inputs: Incident_Move_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Move_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível mover ${i?.incident} para ${i?.status}. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't move ${i?.incident} to ${i?.status}. ${i?.reason}`)
});