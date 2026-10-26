/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_Add_Target_PlaceholderInputs */



/**
* | output |
* | --- |
* | "Choose…" |
*
* @param {Escalation_Add_Target_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_add_target_placeholder = /** @type {((inputs?: Escalation_Add_Target_PlaceholderInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Add_Target_PlaceholderInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Escolher…")
	return /** @type {LocalizedString} */ ("Choose…")
});