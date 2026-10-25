/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ interval: NonNullable<unknown> }} Monitor_Heartbeat_EveryInputs */



/**
* | output |
* | --- |
* | "Expects a ping every {interval}" |
*
* @param {Monitor_Heartbeat_EveryInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_heartbeat_every = /** @type {((inputs: Monitor_Heartbeat_EveryInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Heartbeat_EveryInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Espera um sinal a cada ${i?.interval}`)
	return /** @type {LocalizedString} */ (`Expects a ping every ${i?.interval}`)
});