/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown> }} Sync_Refused_HintInputs */



/**
* | output |
* | --- |
* | "Brigade couldn't load this list. {reason}" |
*
* @param {Sync_Refused_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_refused_hint = /** @type {((inputs: Sync_Refused_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Refused_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`O Brigade não conseguiu carregar esta lista. ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Brigade couldn't load this list. ${i?.reason}`)
});