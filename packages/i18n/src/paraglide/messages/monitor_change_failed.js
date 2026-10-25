/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown>, reason: NonNullable<unknown> }} Monitor_Change_FailedInputs */



/**
* | output |
* | --- |
* | "Couldn't change {name}: {reason}" |
*
* @param {Monitor_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_change_failed = /** @type {((inputs: Monitor_Change_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Change_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Não foi possível alterar ${i?.name}: ${i?.reason}`)
	return /** @type {LocalizedString} */ (`Couldn't change ${i?.name}: ${i?.reason}`)
});