/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ outcome: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_Route_QuietInputs */



/**
* | outcome | output |
* | --- | --- |
* | "suppressed" | "Kept quiet by route {name}: no incident" |
* | "dropped" | "Dropped by route {name}: nobody is paged" |
* | * | "Route: {name}" |
*
* @param {Monitor_Route_QuietInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_route_quiet = /** @type {((inputs: Monitor_Route_QuietInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Route_QuietInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.outcome === "suppressed") return /** @type {LocalizedString} */ (`Silenciado pela rota ${i?.name}: sem incidente`);
		if (i?.outcome === "dropped") return /** @type {LocalizedString} */ (`Descartado pela rota ${i?.name}: ninguém é acionado`);
		return /** @type {LocalizedString} */ (`Rota: ${i?.name}`)
	}
	{
		if (i?.outcome === "suppressed") return /** @type {LocalizedString} */ (`Kept quiet by route ${i?.name}: no incident`);
		if (i?.outcome === "dropped") return /** @type {LocalizedString} */ (`Dropped by route ${i?.name}: nobody is paged`);
		return /** @type {LocalizedString} */ (`Route: ${i?.name}`)
	}
});