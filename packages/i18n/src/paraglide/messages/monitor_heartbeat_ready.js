/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ interval: NonNullable<unknown> }} Monitor_Heartbeat_ReadyInputs */



/**
* | output |
* | --- |
* | "Send a POST to this URL at least every {interval}. It is shown only now: copy it before you close this." |
*
* @param {Monitor_Heartbeat_ReadyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_heartbeat_ready = /** @type {((inputs: Monitor_Heartbeat_ReadyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Heartbeat_ReadyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Envie um POST para esta URL pelo menos a cada ${i?.interval}. Ela só aparece agora: copie antes de fechar.`)
	return /** @type {LocalizedString} */ (`Send a POST to this URL at least every ${i?.interval}. It is shown only now: copy it before you close this.`)
});