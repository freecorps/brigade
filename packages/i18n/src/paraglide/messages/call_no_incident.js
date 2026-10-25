/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_No_IncidentInputs */



/**
* | output |
* | --- |
* | "This page names no incident, so it can't be acknowledged here." |
*
* @param {Call_No_IncidentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_no_incident = /** @type {((inputs?: Call_No_IncidentInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_No_IncidentInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Este acionamento não indica um incidente, então não dá para confirmar aqui.")
	return /** @type {LocalizedString} */ ("This page names no incident, so it can't be acknowledged here.")
});