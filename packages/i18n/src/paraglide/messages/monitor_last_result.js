/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, when: NonNullable<unknown> }} Monitor_Last_ResultInputs */



/**
* | kind | output |
* | --- | --- |
* | "http" | "Checked {when}" |
* | * | "Last ping {when}" |
*
* @param {Monitor_Last_ResultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_last_result = /** @type {((inputs: Monitor_Last_ResultInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Last_ResultInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`Verificado ${i?.when}`);
		return /** @type {LocalizedString} */ (`Último sinal ${i?.when}`)
	}
	{
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`Checked ${i?.when}`);
		return /** @type {LocalizedString} */ (`Last ping ${i?.when}`)
	}
});