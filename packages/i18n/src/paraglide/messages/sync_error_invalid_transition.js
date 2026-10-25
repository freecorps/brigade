/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_Invalid_TransitionInputs */



/**
* | output |
* | --- |
* | "Its status changed in the meantime, so that move is no longer allowed." |
*
* @param {Sync_Error_Invalid_TransitionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_invalid_transition = /** @type {((inputs?: Sync_Error_Invalid_TransitionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_Invalid_TransitionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O status mudou nesse meio-tempo, então essa mudança não é mais permitida.")
	return /** @type {LocalizedString} */ ("Its status changed in the meantime, so that move is no longer allowed.")
});