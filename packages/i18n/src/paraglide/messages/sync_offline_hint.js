/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Offline_HintInputs */



/**
* | output |
* | --- |
* | "Can't reach Brigade right now. Changes are kept and sent when the connection is back." |
*
* @param {Sync_Offline_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_offline_hint = /** @type {((inputs?: Sync_Offline_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Offline_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível conectar ao Brigade agora. As alterações ficam guardadas e são enviadas quando a conexão voltar.")
	return /** @type {LocalizedString} */ ("Can't reach Brigade right now. Changes are kept and sent when the connection is back.")
});