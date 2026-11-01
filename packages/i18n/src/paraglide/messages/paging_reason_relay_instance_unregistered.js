/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_Instance_UnregisteredInputs */



/**
* | output |
* | --- |
* | "This instance isn't registered with the push relay yet, so phones registered through the relay can't be paged." |
*
* @param {Paging_Reason_Relay_Instance_UnregisteredInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_instance_unregistered = /** @type {((inputs?: Paging_Reason_Relay_Instance_UnregisteredInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_Instance_UnregisteredInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Esta instância ainda não está registrada no relay de push, então celulares registrados pelo relay não podem ser acionados.")
	return /** @type {LocalizedString} */ ("This instance isn't registered with the push relay yet, so phones registered through the relay can't be paged.")
});