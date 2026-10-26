/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ time: NonNullable<unknown> }} Paging_Last_OkInputs */



/**
* | output |
* | --- |
* | "Last self-check that got through: {time}" |
*
* @param {Paging_Last_OkInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_last_ok = /** @type {((inputs: Paging_Last_OkInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Last_OkInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Última autoverificação que passou: ${i?.time}`)
	return /** @type {LocalizedString} */ (`Last self-check that got through: ${i?.time}`)
});