/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ severity: NonNullable<unknown> }} Declare_Submit_SeverityInputs */



/**
* | output |
* | --- |
* | "Declare {severity}" |
*
* @param {Declare_Submit_SeverityInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const declare_submit_severity = /** @type {((inputs: Declare_Submit_SeverityInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Submit_SeverityInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Declarar ${i?.severity}`)
	return /** @type {LocalizedString} */ (`Declare ${i?.severity}`)
});