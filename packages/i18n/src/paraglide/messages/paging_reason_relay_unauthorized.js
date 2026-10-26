/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_Reason_Relay_UnauthorizedInputs */



/**
* | output |
* | --- |
* | "The push relay refused Brigade's send token, so no page can go out." |
*
* @param {Paging_Reason_Relay_UnauthorizedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_reason_relay_unauthorized = /** @type {((inputs?: Paging_Reason_Relay_UnauthorizedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_Reason_Relay_UnauthorizedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O relay de push recusou o token de envio do Brigade, então nenhum acionamento consegue sair.")
	return /** @type {LocalizedString} */ ("The push relay refused Brigade's send token, so no page can go out.")
});