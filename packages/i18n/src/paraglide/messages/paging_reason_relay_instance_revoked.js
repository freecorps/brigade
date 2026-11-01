/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Instance_RevokedInputs */



/**
* | output |
* | --- |
* | "The push relay revoked this instance, so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Instance_RevokedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_instance_revoked = /** @type {((inputs?: Paging_Reason_Relay_Instance_RevokedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Instance_RevokedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push revogou esta instância, então celulares registrados pelo relay não podem ser acionados.")
	return /** @type {LocalizedString} */ ("The push relay revoked this instance, so phones registered through the relay can't be paged.")
});