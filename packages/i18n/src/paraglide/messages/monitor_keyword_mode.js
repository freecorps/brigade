/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ mode: NonNullable<unknown> }} Monitor_Keyword_ModeInputs */



/**
* | mode | output |
* | --- | --- |
* | "regex" | "Pattern" |
* | * | "Text" |
*
* @param {Monitor_Keyword_ModeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_keyword_mode = /** @type {((inputs: Monitor_Keyword_ModeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Keyword_ModeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.mode === "regex") return /** @type {LocalizedString} */ (`Padrão`);
		return /** @type {LocalizedString} */ (`Texto`)
	}
	{
		if (i?.mode === "regex") return /** @type {LocalizedString} */ (`Pattern`);
		return /** @type {LocalizedString} */ (`Text`)
	}
});