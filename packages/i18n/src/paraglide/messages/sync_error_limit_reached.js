/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Limit_ReachedInputs */



/**
* | output |
* | --- |
* | "You've reached the limit for this." |
*
* @param {Sync_Error_Limit_ReachedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_limit_reached = /** @type {((inputs?: Sync_Error_Limit_ReachedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Limit_ReachedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Você chegou ao limite para isso.")
	return /** @type {LocalizedString} */ ("You've reached the limit for this.")
});