/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ title: NonNullable<unknown>, body: NonNullable<unknown> }} Call_ScriptInputs */



/**
* | output |
* | --- |
* | "Brigade page. Press 1 at any time to acknowledge. {title}. {body}" |
*
* @param {Call_ScriptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_script = /** @type {((inputs: Call_ScriptInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_ScriptInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Acionamento do Brigade. Pressione 1 a qualquer momento para confirmar. ${i?.title}. ${i?.body}`)
	return /** @type {LocalizedString} */ (`Brigade page. Press 1 at any time to acknowledge. ${i?.title}. ${i?.body}`)
});