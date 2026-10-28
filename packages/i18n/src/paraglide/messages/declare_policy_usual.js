/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Declare_Policy_UsualInputs */



/**
* | output |
* | --- |
* | "Usual (type, service or default)" |
*
* @param {Declare_Policy_UsualInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const declare_policy_usual = /** @type {((inputs?: Declare_Policy_UsualInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Declare_Policy_UsualInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A de sempre (tipo, serviço ou padrão)")
	return /** @type {LocalizedString} */ ("Usual (type, service or default)")
});