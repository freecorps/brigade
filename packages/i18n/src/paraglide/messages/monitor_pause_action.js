/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Monitor_Pause_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "pause" | "Pause" |
* | "prompt" | "Pause checks? A firing alert resolves." |
* | * | "Resume" |
*
* @param {Monitor_Pause_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_pause_action = /** @type {((inputs: Monitor_Pause_ActionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Pause_ActionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "pause") return /** @type {LocalizedString} */ (`Pausar`);
		if (i?.action === "prompt") return /** @type {LocalizedString} */ (`Pausar as verificações? Um alerta ativo é resolvido.`);
		return /** @type {LocalizedString} */ (`Retomar`)
	}
	{
		if (i?.action === "pause") return /** @type {LocalizedString} */ (`Pause`);
		if (i?.action === "prompt") return /** @type {LocalizedString} */ (`Pause checks? A firing alert resolves.`);
		return /** @type {LocalizedString} */ (`Resume`)
	}
});