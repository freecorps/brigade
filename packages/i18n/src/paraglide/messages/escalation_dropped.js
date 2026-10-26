/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_DroppedInputs */



/**
* | output |
* | --- |
* | "People or schedules that are gone were taken out of this policy." |
*
* @param {Escalation_DroppedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_dropped = /** @type {((inputs?: Escalation_DroppedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_DroppedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Pessoas ou escalas que não existem mais foram retiradas desta política.")
	return /** @type {LocalizedString} */ ("People or schedules that are gone were taken out of this policy.")
});