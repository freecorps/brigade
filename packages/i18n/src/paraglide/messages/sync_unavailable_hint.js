/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Unavailable_HintInputs */



/**
* | output |
* | --- |
* | "Couldn't connect to Brigade Sync. For now it only runs in the local stack, started from the repository root:" |
*
* @param {Sync_Unavailable_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_unavailable_hint = /** @type {((inputs?: Sync_Unavailable_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Unavailable_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Não foi possível conectar ao Brigade Sync. Por enquanto ele só roda no stack local, iniciado na raiz do repositório:")
	return /** @type {LocalizedString} */ ("Couldn't connect to Brigade Sync. For now it only runs in the local stack, started from the repository root:")
});