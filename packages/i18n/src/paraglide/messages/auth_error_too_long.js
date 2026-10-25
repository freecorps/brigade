/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ max: NonNullable<unknown> }} Auth_Error_Too_LongInputs */



/**
* | output |
* | --- |
* | "Use at most {max} characters." |
*
* @param {Auth_Error_Too_LongInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const auth_error_too_long = /** @type {((inputs: Auth_Error_Too_LongInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Auth_Error_Too_LongInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Use no máximo ${i?.max} caracteres.`)
	return /** @type {LocalizedString} */ (`Use at most ${i?.max} characters.`)
});