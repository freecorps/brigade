/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ seconds: NonNullable<unknown> }} Stack_Error_TimeoutInputs */



/**
* | output |
* | --- |
* | "The request took longer than {seconds} seconds and was cancelled." |
*
* @param {Stack_Error_TimeoutInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const stack_error_timeout = /** @type {((inputs: Stack_Error_TimeoutInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stack_Error_TimeoutInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`A requisição passou de ${i?.seconds} segundos e foi cancelada.`)
	return /** @type {LocalizedString} */ (`The request took longer than ${i?.seconds} seconds and was cancelled.`)
});