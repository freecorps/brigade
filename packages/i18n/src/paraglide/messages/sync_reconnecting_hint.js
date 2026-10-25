/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Reconnecting_HintInputs */



/**
* | output |
* | --- |
* | "Showing the last list received. Changes you make are sent once the connection is back." |
*
* @param {Sync_Reconnecting_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_reconnecting_hint = /** @type {((inputs?: Sync_Reconnecting_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Reconnecting_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Mostrando a última lista recebida. Suas alterações são enviadas assim que a conexão voltar.")
	return /** @type {LocalizedString} */ ("Showing the last list received. Changes you make are sent once the connection is back.")
});