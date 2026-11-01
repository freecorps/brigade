/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Rate_LimitedInputs */



/**
* | output |
* | --- |
* | "The push relay is limiting this instance's sends, so pages may be late." |
*
* @param {Paging_Reason_Relay_Rate_LimitedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_rate_limited = /** @type {((inputs?: Paging_Reason_Relay_Rate_LimitedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Rate_LimitedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push está limitando os envios desta instância, então acionamentos podem atrasar.")
	return /** @type {LocalizedString} */ ("The push relay is limiting this instance's sends, so pages may be late.")
});