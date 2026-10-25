/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Route_NotifyInputs */



/**
* | output |
* | --- |
* | "A page notification (no call screen)" |
*
* @param {Call_Route_NotifyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_route_notify = /** @type {((inputs?: Call_Route_NotifyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Route_NotifyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Uma notificação de acionamento (sem tela de chamada)")
	return /** @type {LocalizedString} */ ("A page notification (no call screen)")
});