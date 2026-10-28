/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, until: NonNullable<unknown> }} Status_MaintenanceInputs */



/**
* | part | output |
* | --- | --- |
* | "active_title" | "Maintenance in progress" |
* | "upcoming_title" | "Scheduled maintenance" |
* | "window_upcoming" | "{time} to {until}" |
* | "window_active" | "Until {until}" |
* | "outage" | "Planned outage" |
* | "outage_hint" | "The components it affects are down while it runs." |
* | * | "Maintenance" |
*
* @param {Status_MaintenanceInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_maintenance = /** @type {((inputs: Status_MaintenanceInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_MaintenanceInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "active_title") return /** @type {LocalizedString} */ (`Manutenção em andamento`);
		if (i?.part === "upcoming_title") return /** @type {LocalizedString} */ (`Manutenção programada`);
		if (i?.part === "window_upcoming") return /** @type {LocalizedString} */ (`De ${i?.time} a ${i?.until}`);
		if (i?.part === "window_active") return /** @type {LocalizedString} */ (`Até ${i?.until}`);
		if (i?.part === "outage") return /** @type {LocalizedString} */ (`Indisponibilidade planejada`);
		if (i?.part === "outage_hint") return /** @type {LocalizedString} */ (`Os componentes afetados ficam fora do ar enquanto ela dura.`);
		return /** @type {LocalizedString} */ (`Manutenção`)
	}
	{
		if (i?.part === "active_title") return /** @type {LocalizedString} */ (`Maintenance in progress`);
		if (i?.part === "upcoming_title") return /** @type {LocalizedString} */ (`Scheduled maintenance`);
		if (i?.part === "window_upcoming") return /** @type {LocalizedString} */ (`${i?.time} to ${i?.until}`);
		if (i?.part === "window_active") return /** @type {LocalizedString} */ (`Until ${i?.until}`);
		if (i?.part === "outage") return /** @type {LocalizedString} */ (`Planned outage`);
		if (i?.part === "outage_hint") return /** @type {LocalizedString} */ (`The components it affects are down while it runs.`);
		return /** @type {LocalizedString} */ (`Maintenance`)
	}
});