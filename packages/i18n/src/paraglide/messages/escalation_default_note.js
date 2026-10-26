/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_Default_NoteInputs */



/**
* | output |
* | --- |
* | "Every page, from a monitor or declared by hand, goes through the default policy." |
*
* @param {Escalation_Default_NoteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_default_note = /** @type {((inputs?: Escalation_Default_NoteInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Default_NoteInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Toda chamada, de um monitor ou declarada à mão, passa pela política padrão.")
	return /** @type {LocalizedString} */ ("Every page, from a monitor or declared by hand, goes through the default policy.")
});