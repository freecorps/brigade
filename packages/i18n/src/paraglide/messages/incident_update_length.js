/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown>, max: NonNullable<unknown> }} Incident_Update_LengthInputs */



/**
* | output |
* | --- |
* | "{count} of {max} characters" |
*
* @param {Incident_Update_LengthInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_update_length = /** @type {((inputs: Incident_Update_LengthInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_LengthInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`${i?.count} de ${i?.max} caracteres`)
	return /** @type {LocalizedString} */ (`${i?.count} of ${i?.max} characters`)
});