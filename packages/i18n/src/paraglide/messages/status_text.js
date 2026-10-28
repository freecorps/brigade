/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, list: NonNullable<unknown> }} Status_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "public_investigating" | "Investigating" |
* | "public_identified" | "Identified" |
* | "public_monitoring" | "Monitoring" |
* | "public_resolved" | "Resolved" |
* | "component_operational" | "Operational" |
* | "component_degraded" | "Degraded performance" |
* | "component_partial_outage" | "Partial outage" |
* | "component_major_outage" | "Major outage" |
* | "overall_operational" | "All systems operational" |
* | "overall_degraded" | "Some systems are slower than usual" |
* | "overall_partial_outage" | "Some systems are down" |
* | "overall_major_outage" | "Major outage" |
* | "active_title" | "Current incidents" |
* | "history_title" | "Past incidents" |
* | "history_hint" | "The last 90 days." |
* | "history_empty" | "No incidents in the last 90 days." |
* | "components_title" | "Components" |
* | "components_empty" | "No components listed yet." |
* | "affects" | "Affects {list}" |
* | "updated" | "Updated {time}" |
* | "update_at" | "{time}" |
* | "resolved_at" | "Resolved {time}" |
* | "not_found_title" | "No status page here" |
* | "not_found_body" | "This address has no status page, or it isn't public right now." |
* | "unavailable_title" | "Status page unavailable" |
* | "unavailable_body" | "The status page can't be shown right now. Try again in a minute." |
* | "powered" | "Status page by Brigade" |
* | "feed_atom" | "Atom feed" |
* | "feed_json" | "JSON feed" |
* | "component_maintenance" | "Under maintenance" |
* | "overall_maintenance" | "Scheduled maintenance in progress" |
* | "stale" | "This page may be out of date: it was last updated {time}." |
* | "rate_limited_title" | "Too many requests" |
* | "rate_limited_body" | "Too many addresses with no status page were asked for from your network. Try again in a minute." |
* | * | "Status" |
*
* @param {Status_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_text = /** @type {((inputs: Status_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "public_investigating") return /** @type {LocalizedString} */ (`Investigando`);
		if (i?.part === "public_identified") return /** @type {LocalizedString} */ (`Identificado`);
		if (i?.part === "public_monitoring") return /** @type {LocalizedString} */ (`Monitorando`);
		if (i?.part === "public_resolved") return /** @type {LocalizedString} */ (`Resolvido`);
		if (i?.part === "component_operational") return /** @type {LocalizedString} */ (`Operacional`);
		if (i?.part === "component_degraded") return /** @type {LocalizedString} */ (`Desempenho reduzido`);
		if (i?.part === "component_partial_outage") return /** @type {LocalizedString} */ (`Indisponibilidade parcial`);
		if (i?.part === "component_major_outage") return /** @type {LocalizedString} */ (`Indisponibilidade grave`);
		if (i?.part === "overall_operational") return /** @type {LocalizedString} */ (`Todos os sistemas operacionais`);
		if (i?.part === "overall_degraded") return /** @type {LocalizedString} */ (`Alguns sistemas estão mais lentos que o normal`);
		if (i?.part === "overall_partial_outage") return /** @type {LocalizedString} */ (`Alguns sistemas estão fora do ar`);
		if (i?.part === "overall_major_outage") return /** @type {LocalizedString} */ (`Indisponibilidade grave`);
		if (i?.part === "active_title") return /** @type {LocalizedString} */ (`Incidentes em andamento`);
		if (i?.part === "history_title") return /** @type {LocalizedString} */ (`Incidentes anteriores`);
		if (i?.part === "history_hint") return /** @type {LocalizedString} */ (`Os últimos 90 dias.`);
		if (i?.part === "history_empty") return /** @type {LocalizedString} */ (`Nenhum incidente nos últimos 90 dias.`);
		if (i?.part === "components_title") return /** @type {LocalizedString} */ (`Componentes`);
		if (i?.part === "components_empty") return /** @type {LocalizedString} */ (`Nenhum componente listado ainda.`);
		if (i?.part === "affects") return /** @type {LocalizedString} */ (`Afeta ${i?.list}`);
		if (i?.part === "updated") return /** @type {LocalizedString} */ (`Atualizado em ${i?.time}`);
		if (i?.part === "update_at") return /** @type {LocalizedString} */ (`${i?.time}`);
		if (i?.part === "resolved_at") return /** @type {LocalizedString} */ (`Resolvido em ${i?.time}`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`Nenhuma página de status aqui`);
		if (i?.part === "not_found_body") return /** @type {LocalizedString} */ (`Este endereço não tem página de status, ou ela não está pública agora.`);
		if (i?.part === "unavailable_title") return /** @type {LocalizedString} */ (`Página de status indisponível`);
		if (i?.part === "unavailable_body") return /** @type {LocalizedString} */ (`A página de status não pode ser exibida agora. Tente de novo em um minuto.`);
		if (i?.part === "powered") return /** @type {LocalizedString} */ (`Página de status do Brigade`);
		if (i?.part === "feed_atom") return /** @type {LocalizedString} */ (`Feed Atom`);
		if (i?.part === "feed_json") return /** @type {LocalizedString} */ (`Feed JSON`);
		if (i?.part === "component_maintenance") return /** @type {LocalizedString} */ (`Em manutenção`);
		if (i?.part === "overall_maintenance") return /** @type {LocalizedString} */ (`Manutenção programada em andamento`);
		if (i?.part === "stale") return /** @type {LocalizedString} */ (`Esta página pode estar desatualizada: a última atualização foi em ${i?.time}.`);
		if (i?.part === "rate_limited_title") return /** @type {LocalizedString} */ (`Muitas solicitações`);
		if (i?.part === "rate_limited_body") return /** @type {LocalizedString} */ (`Sua rede pediu muitos endereços sem página de status. Tente de novo em um minuto.`);
		return /** @type {LocalizedString} */ (`Status`)
	}
	{
		if (i?.part === "public_investigating") return /** @type {LocalizedString} */ (`Investigating`);
		if (i?.part === "public_identified") return /** @type {LocalizedString} */ (`Identified`);
		if (i?.part === "public_monitoring") return /** @type {LocalizedString} */ (`Monitoring`);
		if (i?.part === "public_resolved") return /** @type {LocalizedString} */ (`Resolved`);
		if (i?.part === "component_operational") return /** @type {LocalizedString} */ (`Operational`);
		if (i?.part === "component_degraded") return /** @type {LocalizedString} */ (`Degraded performance`);
		if (i?.part === "component_partial_outage") return /** @type {LocalizedString} */ (`Partial outage`);
		if (i?.part === "component_major_outage") return /** @type {LocalizedString} */ (`Major outage`);
		if (i?.part === "overall_operational") return /** @type {LocalizedString} */ (`All systems operational`);
		if (i?.part === "overall_degraded") return /** @type {LocalizedString} */ (`Some systems are slower than usual`);
		if (i?.part === "overall_partial_outage") return /** @type {LocalizedString} */ (`Some systems are down`);
		if (i?.part === "overall_major_outage") return /** @type {LocalizedString} */ (`Major outage`);
		if (i?.part === "active_title") return /** @type {LocalizedString} */ (`Current incidents`);
		if (i?.part === "history_title") return /** @type {LocalizedString} */ (`Past incidents`);
		if (i?.part === "history_hint") return /** @type {LocalizedString} */ (`The last 90 days.`);
		if (i?.part === "history_empty") return /** @type {LocalizedString} */ (`No incidents in the last 90 days.`);
		if (i?.part === "components_title") return /** @type {LocalizedString} */ (`Components`);
		if (i?.part === "components_empty") return /** @type {LocalizedString} */ (`No components listed yet.`);
		if (i?.part === "affects") return /** @type {LocalizedString} */ (`Affects ${i?.list}`);
		if (i?.part === "updated") return /** @type {LocalizedString} */ (`Updated ${i?.time}`);
		if (i?.part === "update_at") return /** @type {LocalizedString} */ (`${i?.time}`);
		if (i?.part === "resolved_at") return /** @type {LocalizedString} */ (`Resolved ${i?.time}`);
		if (i?.part === "not_found_title") return /** @type {LocalizedString} */ (`No status page here`);
		if (i?.part === "not_found_body") return /** @type {LocalizedString} */ (`This address has no status page, or it isn't public right now.`);
		if (i?.part === "unavailable_title") return /** @type {LocalizedString} */ (`Status page unavailable`);
		if (i?.part === "unavailable_body") return /** @type {LocalizedString} */ (`The status page can't be shown right now. Try again in a minute.`);
		if (i?.part === "powered") return /** @type {LocalizedString} */ (`Status page by Brigade`);
		if (i?.part === "feed_atom") return /** @type {LocalizedString} */ (`Atom feed`);
		if (i?.part === "feed_json") return /** @type {LocalizedString} */ (`JSON feed`);
		if (i?.part === "component_maintenance") return /** @type {LocalizedString} */ (`Under maintenance`);
		if (i?.part === "overall_maintenance") return /** @type {LocalizedString} */ (`Scheduled maintenance in progress`);
		if (i?.part === "stale") return /** @type {LocalizedString} */ (`This page may be out of date: it was last updated ${i?.time}.`);
		if (i?.part === "rate_limited_title") return /** @type {LocalizedString} */ (`Too many requests`);
		if (i?.part === "rate_limited_body") return /** @type {LocalizedString} */ (`Too many addresses with no status page were asked for from your network. Try again in a minute.`);
		return /** @type {LocalizedString} */ (`Status`)
	}
});