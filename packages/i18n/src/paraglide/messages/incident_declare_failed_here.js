/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown> }} Incident_Declare_Failed_HereInputs */



/**
* | output |
* | --- |
* | "Couldn't declare it. {reason}" |
*
* @param {Incident_Declare_Failed_HereInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_declare_failed_here = /** @type {((inputs: Incident_Declare_Failed_HereInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Declare_Failed_HereInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível declarar. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't declare it. ${i?.reason}`)
});