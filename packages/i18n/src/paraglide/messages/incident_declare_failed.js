/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ title: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Declare_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't declare “{title}”. {reason}" |
*
* @param {Incident_Declare_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_declare_failed = /** @type {((inputs: Incident_Declare_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Declare_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível declarar “${i?.title}”. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't declare “${i?.title}”. ${i?.reason}`)
});