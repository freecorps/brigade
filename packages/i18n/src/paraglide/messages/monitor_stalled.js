/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ regions: NonNullable<unknown> }} Monitor_StalledInputs */



/**
* | output |
* | --- |
* | "Checks from {regions} stopped reporting. Monitors there show No data until they report again, and nobody is paged for it." |
*
* @param {Monitor_StalledInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_stalled = /** @type {((inputs: Monitor_StalledInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_StalledInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`As verificações de ${i?.regions} pararam de chegar. Os monitores de lá mostram Sem dados até voltarem, e ninguém é chamado por isso.`)
	return /** @type {LocalizedString} */ (`Checks from ${i?.regions} stopped reporting. Monitors there show No data until they report again, and nobody is paged for it.`)
});