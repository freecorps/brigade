/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Monitor_Expected_Status_HintInputs */



/**
* | output |
* | --- |
* | "Empty: any 2xx or 3xx. Redirects are not followed." |
*
* @param {Monitor_Expected_Status_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_expected_status_hint = /** @type {((inputs?: Monitor_Expected_Status_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Expected_Status_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Vazio: qualquer 2xx ou 3xx. Redirecionamentos não são seguidos.")
	return /** @type {LocalizedString} */ ("Empty: any 2xx or 3xx. Redirects are not followed.")
});