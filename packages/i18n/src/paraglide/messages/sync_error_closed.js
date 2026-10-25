/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sync_Error_ClosedInputs */



/**
* | output |
* | --- |
* | "This page stopped syncing. Reload it to try again." |
*
* @param {Sync_Error_ClosedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const sync_error_closed = /** @type {((inputs?: Sync_Error_ClosedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sync_Error_ClosedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Esta página parou de sincronizar. Recarregue para tentar de novo.")
	return /** @type {LocalizedString} */ ("This page stopped syncing. Reload it to try again.")
});