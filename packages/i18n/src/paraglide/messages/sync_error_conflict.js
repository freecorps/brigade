/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_ConflictInputs */



/**
* | output |
* | --- |
* | "Someone changed it first." |
*
* @param {Sync_Error_ConflictInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_conflict = /** @type {((inputs?: Sync_Error_ConflictInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ConflictInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Alguém alterou antes.")
	return /** @type {LocalizedString} */ ("Someone changed it first.")
});