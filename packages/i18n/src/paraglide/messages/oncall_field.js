/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Oncall_FieldInputs */



/**
* | field | output |
* | --- | --- |
* | "name" | "Name" |
* | "time_zone" | "Time zone" |
* | "layer_name" | "Layer name" |
* | "start_date" | "Starts on" |
* | "handoff_time" | "Handoff time" |
* | "count" | "Shift length" |
* | "unit" | "Unit" |
* | "members" | "People, in rotation order" |
* | "who" | "Who covers" |
* | "start" | "From" |
* | * | "Until" |
*
* @param {Oncall_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_field = /** @type {((inputs: Oncall_FieldInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_FieldInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.field === "time_zone") return /** @type {LocalizedString} */ (`Fuso horário`);
		if (i?.field === "layer_name") return /** @type {LocalizedString} */ (`Nome da camada`);
		if (i?.field === "start_date") return /** @type {LocalizedString} */ (`Começa em`);
		if (i?.field === "handoff_time") return /** @type {LocalizedString} */ (`Horário da troca`);
		if (i?.field === "count") return /** @type {LocalizedString} */ (`Duração do turno`);
		if (i?.field === "unit") return /** @type {LocalizedString} */ (`Unidade`);
		if (i?.field === "members") return /** @type {LocalizedString} */ (`Pessoas, na ordem do rodízio`);
		if (i?.field === "who") return /** @type {LocalizedString} */ (`Quem cobre`);
		if (i?.field === "start") return /** @type {LocalizedString} */ (`De`);
		return /** @type {LocalizedString} */ (`Até`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Name`);
		if (i?.field === "time_zone") return /** @type {LocalizedString} */ (`Time zone`);
		if (i?.field === "layer_name") return /** @type {LocalizedString} */ (`Layer name`);
		if (i?.field === "start_date") return /** @type {LocalizedString} */ (`Starts on`);
		if (i?.field === "handoff_time") return /** @type {LocalizedString} */ (`Handoff time`);
		if (i?.field === "count") return /** @type {LocalizedString} */ (`Shift length`);
		if (i?.field === "unit") return /** @type {LocalizedString} */ (`Unit`);
		if (i?.field === "members") return /** @type {LocalizedString} */ (`People, in rotation order`);
		if (i?.field === "who") return /** @type {LocalizedString} */ (`Who covers`);
		if (i?.field === "start") return /** @type {LocalizedString} */ (`From`);
		return /** @type {LocalizedString} */ (`Until`)
	}
});