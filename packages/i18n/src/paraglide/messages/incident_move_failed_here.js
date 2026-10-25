/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ status: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Move_Failed_HereInputs */



/**
* | output |
* | --- |
* | "Couldn't move it to {status}. {reason}" |
*
* @param {Incident_Move_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_move_failed_here = /** @type {((inputs: Incident_Move_Failed_HereInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Move_Failed_HereInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível mover para ${i?.status}. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't move it to ${i?.status}. ${i?.reason}`)
});