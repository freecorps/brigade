/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Monitor_Pause_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "pause" | "Pause" |
* | "prompt" | "Pause this monitor? Its checks stop until you resume it." |
* | "prompt_alert" | "Pause this monitor? Its checks stop until you resume it, and its firing alert resolves." |
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
		if (i?.action === "prompt") return /** @type {LocalizedString} */ (`Pausar este monitor? As verificações param até você retomá-lo.`);
		if (i?.action === "prompt_alert") return /** @type {LocalizedString} */ (`Pausar este monitor? As verificações param até você retomá-lo, e o alerta ativo é resolvido.`);
		return /** @type {LocalizedString} */ (`Retomar`)
	}
	{
		if (i?.action === "pause") return /** @type {LocalizedString} */ (`Pause`);
		if (i?.action === "prompt") return /** @type {LocalizedString} */ (`Pause this monitor? Its checks stop until you resume it.`);
		if (i?.action === "prompt_alert") return /** @type {LocalizedString} */ (`Pause this monitor? Its checks stop until you resume it, and its firing alert resolves.`);
		return /** @type {LocalizedString} */ (`Resume`)
	}
});