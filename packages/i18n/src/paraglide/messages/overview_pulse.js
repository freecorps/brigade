/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, count: NonNullable<unknown>, total: NonNullable<unknown>, share: NonNullable<unknown> }} Overview_PulseInputs */



/**
* | part | output |
* | --- | --- |
* | "incidents_label" | "Active incidents" |
* | "incidents_clear" | "All clear" |
* | "incidents_link" | "Open incidents" |
* | "monitors_label" | "Monitors" |
* | "monitors_up" | "{count} of {total} up" |
* | "monitors_none" | "No monitors yet" |
* | "monitors_link" | "Open monitors" |
* | "follow_label" | "Open follow-ups" |
* | "follow_overdue" | "Overdue: {count}" |
* | "follow_none" | "Nothing overdue" |
* | "follow_link" | "Open follow-ups" |
* | "glance_title" | "Monitors" |
* | "glance_description" | "Each monitor's recent checks, every region on one line." |
* | "glance_all" | "All monitors" |
* | "recent_up" | "{share} up in recent checks" |
* | "regions" | "Regions: {count}" |
* | "regions_down" | "{count} of {total} regions down" |
* | "no_history" | "No checks yet" |
* | "alerts_title" | "Alerts, last 24 hours" |
* | "alerts_description" | "Alerts that started firing in each hour, from every alert source." |
* | "alerts_total" | "Total: {count}" |
* | "alerts_row" | "Alerts" |
* | * | "Brigade" |
*
* @param {Overview_PulseInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const overview_pulse = /** @type {((inputs: Overview_PulseInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Overview_PulseInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "incidents_label") return /** @type {LocalizedString} */ (`Incidentes ativos`);
		if (i?.part === "incidents_clear") return /** @type {LocalizedString} */ (`Tudo calmo`);
		if (i?.part === "incidents_link") return /** @type {LocalizedString} */ (`Abrir incidentes`);
		if (i?.part === "monitors_label") return /** @type {LocalizedString} */ (`Monitores`);
		if (i?.part === "monitors_up") return /** @type {LocalizedString} */ (`${i?.count} de ${i?.total} no ar`);
		if (i?.part === "monitors_none") return /** @type {LocalizedString} */ (`Nenhum monitor ainda`);
		if (i?.part === "monitors_link") return /** @type {LocalizedString} */ (`Abrir monitores`);
		if (i?.part === "follow_label") return /** @type {LocalizedString} */ (`Ações em aberto`);
		if (i?.part === "follow_overdue") return /** @type {LocalizedString} */ (`Atrasadas: ${i?.count}`);
		if (i?.part === "follow_none") return /** @type {LocalizedString} */ (`Nada atrasado`);
		if (i?.part === "follow_link") return /** @type {LocalizedString} */ (`Abrir ações`);
		if (i?.part === "glance_title") return /** @type {LocalizedString} */ (`Monitores`);
		if (i?.part === "glance_description") return /** @type {LocalizedString} */ (`Os checks recentes de cada monitor, todas as regiões numa linha.`);
		if (i?.part === "glance_all") return /** @type {LocalizedString} */ (`Todos os monitores`);
		if (i?.part === "recent_up") return /** @type {LocalizedString} */ (`${i?.share} no ar nos checks recentes`);
		if (i?.part === "regions") return /** @type {LocalizedString} */ (`Regiões: ${i?.count}`);
		if (i?.part === "regions_down") return /** @type {LocalizedString} */ (`${i?.count} de ${i?.total} regiões fora`);
		if (i?.part === "no_history") return /** @type {LocalizedString} */ (`Nenhum check ainda`);
		if (i?.part === "alerts_title") return /** @type {LocalizedString} */ (`Alertas nas últimas 24 horas`);
		if (i?.part === "alerts_description") return /** @type {LocalizedString} */ (`Alertas que começaram a disparar em cada hora, de todas as fontes de alertas.`);
		if (i?.part === "alerts_total") return /** @type {LocalizedString} */ (`Total: ${i?.count}`);
		if (i?.part === "alerts_row") return /** @type {LocalizedString} */ (`Alertas`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.part === "incidents_label") return /** @type {LocalizedString} */ (`Active incidents`);
		if (i?.part === "incidents_clear") return /** @type {LocalizedString} */ (`All clear`);
		if (i?.part === "incidents_link") return /** @type {LocalizedString} */ (`Open incidents`);
		if (i?.part === "monitors_label") return /** @type {LocalizedString} */ (`Monitors`);
		if (i?.part === "monitors_up") return /** @type {LocalizedString} */ (`${i?.count} of ${i?.total} up`);
		if (i?.part === "monitors_none") return /** @type {LocalizedString} */ (`No monitors yet`);
		if (i?.part === "monitors_link") return /** @type {LocalizedString} */ (`Open monitors`);
		if (i?.part === "follow_label") return /** @type {LocalizedString} */ (`Open follow-ups`);
		if (i?.part === "follow_overdue") return /** @type {LocalizedString} */ (`Overdue: ${i?.count}`);
		if (i?.part === "follow_none") return /** @type {LocalizedString} */ (`Nothing overdue`);
		if (i?.part === "follow_link") return /** @type {LocalizedString} */ (`Open follow-ups`);
		if (i?.part === "glance_title") return /** @type {LocalizedString} */ (`Monitors`);
		if (i?.part === "glance_description") return /** @type {LocalizedString} */ (`Each monitor's recent checks, every region on one line.`);
		if (i?.part === "glance_all") return /** @type {LocalizedString} */ (`All monitors`);
		if (i?.part === "recent_up") return /** @type {LocalizedString} */ (`${i?.share} up in recent checks`);
		if (i?.part === "regions") return /** @type {LocalizedString} */ (`Regions: ${i?.count}`);
		if (i?.part === "regions_down") return /** @type {LocalizedString} */ (`${i?.count} of ${i?.total} regions down`);
		if (i?.part === "no_history") return /** @type {LocalizedString} */ (`No checks yet`);
		if (i?.part === "alerts_title") return /** @type {LocalizedString} */ (`Alerts, last 24 hours`);
		if (i?.part === "alerts_description") return /** @type {LocalizedString} */ (`Alerts that started firing in each hour, from every alert source.`);
		if (i?.part === "alerts_total") return /** @type {LocalizedString} */ (`Total: ${i?.count}`);
		if (i?.part === "alerts_row") return /** @type {LocalizedString} */ (`Alerts`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});