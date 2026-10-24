/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Intl_DescriptionInputs */



/**
* | output |
* | --- |
* | "What this JavaScript engine provides on its own, and what the shared helpers render with it." |
*
* @param {Intl_DescriptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const intl_description = /** @type {((inputs?: Intl_DescriptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Intl_DescriptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O que este motor JavaScript oferece sozinho e o que os helpers compartilhados exibem com isso.")
	return /** @type {LocalizedString} */ ("What this JavaScript engine provides on its own, and what the shared helpers render with it.")
});