/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Monitor_Pause_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "pause" | "Pause" |
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
		return /** @type {LocalizedString} */ (`Retomar`)
	}
	{
		if (i?.action === "pause") return /** @type {LocalizedString} */ (`Pause`);
		return /** @type {LocalizedString} */ (`Resume`)
	}
});