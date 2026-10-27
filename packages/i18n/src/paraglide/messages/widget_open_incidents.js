/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Widget_Open_IncidentsInputs */



/**
* | output |
* | --- |
* | "Open incidents" |
*
* @param {Widget_Open_IncidentsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const widget_open_incidents = /** @type {((inputs?: Widget_Open_IncidentsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Widget_Open_IncidentsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Incidentes abertos")
	return /** @type {LocalizedString} */ ("Open incidents")
});