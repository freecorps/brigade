/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_DiscardInputs */



/**
* | part | output |
* | --- | --- |
* | "prompt" | "Discard your changes to {name}?" |
* | "prompt_new" | "Discard this new monitor?" |
* | "discard" | "Discard changes" |
* | * | "Keep editing" |
*
* @param {Monitor_DiscardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_discard = /** @type {((inputs: Monitor_DiscardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_DiscardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Descartar as alterações em ${i?.name}?`);
		if (i?.part === "prompt_new") return /** @type {LocalizedString} */ (`Descartar este novo monitor?`);
		if (i?.part === "discard") return /** @type {LocalizedString} */ (`Descartar alterações`);
		return /** @type {LocalizedString} */ (`Continuar editando`)
	}
	{
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Discard your changes to ${i?.name}?`);
		if (i?.part === "prompt_new") return /** @type {LocalizedString} */ (`Discard this new monitor?`);
		if (i?.part === "discard") return /** @type {LocalizedString} */ (`Discard changes`);
		return /** @type {LocalizedString} */ (`Keep editing`)
	}
});