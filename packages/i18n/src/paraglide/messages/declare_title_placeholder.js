/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Declare_Title_PlaceholderInputs */



/**
* | output |
* | --- |
* | "What's happening?" |
*
* @param {Declare_Title_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const declare_title_placeholder = /** @type {((inputs?: Declare_Title_PlaceholderInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Title_PlaceholderInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O que está acontecendo?")
	return /** @type {LocalizedString} */ ("What's happening?")
});