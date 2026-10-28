/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, percent: NonNullable<unknown>, date: NonNullable<unknown>, minutes: NonNullable<unknown> }} Status_UptimeInputs */



/**
* | part | output |
* | --- | --- |
* | "summary" | "{percent}% uptime in the last 90 days" |
* | "no_data" | "No uptime data yet" |
* | "day_up" | "{date}: no downtime" |
* | "day_degraded" | "{date}: {minutes} min of downtime" |
* | "day_down" | "{date}: down for {minutes} min" |
* | "day_none" | "{date}: no data" |
* | "start" | "90 days ago" |
* | "start_short" | "30 days ago" |
* | "percent" | "{percent}% uptime" |
* | "end" | "Today" |
* | * | "Uptime" |
*
* @param {Status_UptimeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_uptime = /** @type {((inputs: Status_UptimeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_UptimeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "summary") return /** @type {LocalizedString} */ (`${i?.percent}% de disponibilidade nos últimos 90 dias`);
		if (i?.part === "no_data") return /** @type {LocalizedString} */ (`Ainda sem dados de disponibilidade`);
		if (i?.part === "day_up") return /** @type {LocalizedString} */ (`${i?.date}: sem indisponibilidade`);
		if (i?.part === "day_degraded") return /** @type {LocalizedString} */ (`${i?.date}: ${i?.minutes} min de indisponibilidade`);
		if (i?.part === "day_down") return /** @type {LocalizedString} */ (`${i?.date}: fora do ar por ${i?.minutes} min`);
		if (i?.part === "day_none") return /** @type {LocalizedString} */ (`${i?.date}: sem dados`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`90 dias atrás`);
		if (i?.part === "start_short") return /** @type {LocalizedString} */ (`30 dias atrás`);
		if (i?.part === "percent") return /** @type {LocalizedString} */ (`${i?.percent}% de disponibilidade`);
		if (i?.part === "end") return /** @type {LocalizedString} */ (`Hoje`);
		return /** @type {LocalizedString} */ (`Disponibilidade`)
	}
	{
		if (i?.part === "summary") return /** @type {LocalizedString} */ (`${i?.percent}% uptime in the last 90 days`);
		if (i?.part === "no_data") return /** @type {LocalizedString} */ (`No uptime data yet`);
		if (i?.part === "day_up") return /** @type {LocalizedString} */ (`${i?.date}: no downtime`);
		if (i?.part === "day_degraded") return /** @type {LocalizedString} */ (`${i?.date}: ${i?.minutes} min of downtime`);
		if (i?.part === "day_down") return /** @type {LocalizedString} */ (`${i?.date}: down for ${i?.minutes} min`);
		if (i?.part === "day_none") return /** @type {LocalizedString} */ (`${i?.date}: no data`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`90 days ago`);
		if (i?.part === "start_short") return /** @type {LocalizedString} */ (`30 days ago`);
		if (i?.part === "percent") return /** @type {LocalizedString} */ (`${i?.percent}% uptime`);
		if (i?.part === "end") return /** @type {LocalizedString} */ (`Today`);
		return /** @type {LocalizedString} */ (`Uptime`)
	}
});