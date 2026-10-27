/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Export_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Export" |
* | "incident_action" | "Export JSON" |
* | "incident_hint" | "The incident, its timeline, updates, follow-ups and postmortem, as one JSON file. Owners and admins only." |
* | "card_title" | "Export incidents" |
* | "card_description" | "Download the incidents declared in a date range (UTC) as JSON: timelines, updates, follow-ups and postmortems. Files can be downloaded for 7 days." |
* | "from" | "From" |
* | "to" | "To" |
* | "create" | "Export" |
* | "creating" | "Exporting…" |
* | "ready" | "Export ready." |
* | "download" | "Download" |
* | "recent" | "Recent exports" |
* | "none" | "No exports yet." |
* | "expires" | "Expires {time}" |
* | "scope_incident" | "Incident {name}" |
* | "scope_range" | "{name}" |
* | "failed_too_large" | "Too many incidents for one file. Pick a shorter range." |
* | "failed_limit_reached" | "Too many incidents for one file. Pick a shorter range." |
* | "failed_invalid_args" | "Pick a range of up to 366 days, the start before the end." |
* | "failed_exports_unavailable" | "Exports aren't set up on this server." |
* | "failed_other" | "Couldn't export: {reason}" |
* | * | "Export" |
*
* @param {Export_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const export_text = /** @type {((inputs: Export_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Export_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Exportar`);
		if (i?.part === "incident_action") return /** @type {LocalizedString} */ (`Exportar JSON`);
		if (i?.part === "incident_hint") return /** @type {LocalizedString} */ (`O incidente, sua linha do tempo, atualizações, ações e postmortem, em um arquivo JSON. Só owners e admins.`);
		if (i?.part === "card_title") return /** @type {LocalizedString} */ (`Exportar incidentes`);
		if (i?.part === "card_description") return /** @type {LocalizedString} */ (`Baixe os incidentes declarados em um período (UTC) em JSON: linhas do tempo, atualizações, ações e postmortems. Os arquivos ficam disponíveis por 7 dias.`);
		if (i?.part === "from") return /** @type {LocalizedString} */ (`De`);
		if (i?.part === "to") return /** @type {LocalizedString} */ (`Até`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Exportar`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Exportando…`);
		if (i?.part === "ready") return /** @type {LocalizedString} */ (`Exportação pronta.`);
		if (i?.part === "download") return /** @type {LocalizedString} */ (`Baixar`);
		if (i?.part === "recent") return /** @type {LocalizedString} */ (`Exportações recentes`);
		if (i?.part === "none") return /** @type {LocalizedString} */ (`Nenhuma exportação ainda.`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expira ${i?.time}`);
		if (i?.part === "scope_incident") return /** @type {LocalizedString} */ (`Incidente ${i?.name}`);
		if (i?.part === "scope_range") return /** @type {LocalizedString} */ (`${i?.name}`);
		if (i?.part === "failed_too_large") return /** @type {LocalizedString} */ (`Incidentes demais para um arquivo. Escolha um período menor.`);
		if (i?.part === "failed_limit_reached") return /** @type {LocalizedString} */ (`Incidentes demais para um arquivo. Escolha um período menor.`);
		if (i?.part === "failed_invalid_args") return /** @type {LocalizedString} */ (`Escolha um período de até 366 dias, com o início antes do fim.`);
		if (i?.part === "failed_exports_unavailable") return /** @type {LocalizedString} */ (`As exportações não estão configuradas neste servidor.`);
		if (i?.part === "failed_other") return /** @type {LocalizedString} */ (`Não foi possível exportar: ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Exportar`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Export`);
		if (i?.part === "incident_action") return /** @type {LocalizedString} */ (`Export JSON`);
		if (i?.part === "incident_hint") return /** @type {LocalizedString} */ (`The incident, its timeline, updates, follow-ups and postmortem, as one JSON file. Owners and admins only.`);
		if (i?.part === "card_title") return /** @type {LocalizedString} */ (`Export incidents`);
		if (i?.part === "card_description") return /** @type {LocalizedString} */ (`Download the incidents declared in a date range (UTC) as JSON: timelines, updates, follow-ups and postmortems. Files can be downloaded for 7 days.`);
		if (i?.part === "from") return /** @type {LocalizedString} */ (`From`);
		if (i?.part === "to") return /** @type {LocalizedString} */ (`To`);
		if (i?.part === "create") return /** @type {LocalizedString} */ (`Export`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Exporting…`);
		if (i?.part === "ready") return /** @type {LocalizedString} */ (`Export ready.`);
		if (i?.part === "download") return /** @type {LocalizedString} */ (`Download`);
		if (i?.part === "recent") return /** @type {LocalizedString} */ (`Recent exports`);
		if (i?.part === "none") return /** @type {LocalizedString} */ (`No exports yet.`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expires ${i?.time}`);
		if (i?.part === "scope_incident") return /** @type {LocalizedString} */ (`Incident ${i?.name}`);
		if (i?.part === "scope_range") return /** @type {LocalizedString} */ (`${i?.name}`);
		if (i?.part === "failed_too_large") return /** @type {LocalizedString} */ (`Too many incidents for one file. Pick a shorter range.`);
		if (i?.part === "failed_limit_reached") return /** @type {LocalizedString} */ (`Too many incidents for one file. Pick a shorter range.`);
		if (i?.part === "failed_invalid_args") return /** @type {LocalizedString} */ (`Pick a range of up to 366 days, the start before the end.`);
		if (i?.part === "failed_exports_unavailable") return /** @type {LocalizedString} */ (`Exports aren't set up on this server.`);
		if (i?.part === "failed_other") return /** @type {LocalizedString} */ (`Couldn't export: ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Export`)
	}
});