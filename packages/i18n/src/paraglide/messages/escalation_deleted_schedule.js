/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_Deleted_ScheduleInputs */



/**
* | output |
* | --- |
* | "Deleted schedule" |
*
* @param {Escalation_Deleted_ScheduleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_deleted_schedule = /** @type {((inputs?: Escalation_Deleted_ScheduleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Deleted_ScheduleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Escala excluída")
	return /** @type {LocalizedString} */ ("Deleted schedule")
});