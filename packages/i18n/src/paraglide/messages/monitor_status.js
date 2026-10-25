/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ status: NonNullable<unknown> }} Monitor_StatusInputs */



/**
* | status | output |
* | --- | --- |
* | "up" | "Up" |
* | "down" | "Down" |
* | "paused" | "Paused" |
* | * | "Waiting" |
*
* @param {Monitor_StatusInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_status = /** @type {((inputs: Monitor_StatusInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_StatusInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.status === "up") return /** @type {LocalizedString} */ (`No ar`);
		if (i?.status === "down") return /** @type {LocalizedString} */ (`Fora do ar`);
		if (i?.status === "paused") return /** @type {LocalizedString} */ (`Pausado`);
		return /** @type {LocalizedString} */ (`Aguardando`)
	}
	{
		if (i?.status === "up") return /** @type {LocalizedString} */ (`Up`);
		if (i?.status === "down") return /** @type {LocalizedString} */ (`Down`);
		if (i?.status === "paused") return /** @type {LocalizedString} */ (`Paused`);
		return /** @type {LocalizedString} */ (`Waiting`)
	}
});