/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ title: NonNullable<unknown> }} Declare_SentInputs */



/**
* | output |
* | --- |
* | "Sent “{title}”. It shows here once the list loads." |
*
* @param {Declare_SentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const declare_sent = /** @type {((inputs: Declare_SentInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_SentInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`“${i?.title}” enviado. Ele aparece aqui quando a lista carregar.`)
	return /** @type {LocalizedString} */ (`Sent “${i?.title}”. It shows here once the list loads.`)
});