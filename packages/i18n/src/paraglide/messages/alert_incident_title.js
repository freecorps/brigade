/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Alert_Incident_TitleInputs */



/**
* | part | output |
* | --- | --- |
* | "malformed" | "Unreadable alert from {name}" |
* | "too_large" | "Unreadable alert from {name} (payload too large)" |
* | "capacity" | "Alert capacity reached" |
* | * | "Unreadable alert from {name}" |
*
* @param {Alert_Incident_TitleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const alert_incident_title = /** @type {((inputs: Alert_Incident_TitleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Alert_Incident_TitleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "malformed") return /** @type {LocalizedString} */ (`Alerta ilegível de ${i?.name}`);
		if (i?.part === "too_large") return /** @type {LocalizedString} */ (`Alerta ilegível de ${i?.name} (conteúdo grande demais)`);
		if (i?.part === "capacity") return /** @type {LocalizedString} */ (`Capacidade de alertas atingida`);
		return /** @type {LocalizedString} */ (`Alerta ilegível de ${i?.name}`)
	}
	{
		if (i?.part === "malformed") return /** @type {LocalizedString} */ (`Unreadable alert from ${i?.name}`);
		if (i?.part === "too_large") return /** @type {LocalizedString} */ (`Unreadable alert from ${i?.name} (payload too large)`);
		if (i?.part === "capacity") return /** @type {LocalizedString} */ (`Alert capacity reached`);
		return /** @type {LocalizedString} */ (`Unreadable alert from ${i?.name}`)
	}
});