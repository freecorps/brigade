/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Call_Test_No_IncidentInputs */



/**
* | output |
* | --- |
* | "Declare an incident first: the call acknowledges it." |
*
* @param {Call_Test_No_IncidentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const call_test_no_incident = /** @type {((inputs?: Call_Test_No_IncidentInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Call_Test_No_IncidentInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Declare um incidente antes: a chamada confirma esse incidente.")
	return /** @type {LocalizedString} */ ("Declare an incident first: the call acknowledges it.")
});