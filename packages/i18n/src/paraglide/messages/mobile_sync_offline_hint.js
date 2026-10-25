/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mobile_Sync_Offline_HintInputs */



/**
* | output |
* | --- |
* | "Can't reach Brigade right now. Changes you make are sent when the connection is back, as long as the app stays open." |
*
* @param {Mobile_Sync_Offline_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_sync_offline_hint = /** @type {((inputs?: Mobile_Sync_Offline_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Sync_Offline_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível conectar ao Brigade agora. Suas alterações são enviadas quando a conexão voltar, desde que o app continue aberto.")
	return /** @type {LocalizedString} */ ("Can't reach Brigade right now. Changes you make are sent when the connection is back, as long as the app stays open.")
});