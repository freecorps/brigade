/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Oncall_Field_InvalidInputs */



/**
* | field | output |
* | --- | --- |
* | "name" | "Enter a name, up to 80 characters." |
* | "time_zone" | "Choose a time zone." |
* | "layer_name" | "Enter a layer name, up to 60 characters." |
* | "start_date" | "Enter a date from 2000 to 2099." |
* | "handoff_time" | "Enter a time." |
* | "members" | "Add at least one person." |
* | "user" | "Choose who covers." |
* | "start" | "Enter when the override starts." |
* | * | "End after the start, in the future, at most 90 days later." |
*
* @param {Oncall_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_field_invalid = /** @type {((inputs: Oncall_Field_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Field_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Informe um nome de até 80 caracteres.`);
		if (i?.field === "time_zone") return /** @type {LocalizedString} */ (`Escolha um fuso horário.`);
		if (i?.field === "layer_name") return /** @type {LocalizedString} */ (`Informe um nome de camada de até 60 caracteres.`);
		if (i?.field === "start_date") return /** @type {LocalizedString} */ (`Informe uma data de 2000 a 2099.`);
		if (i?.field === "handoff_time") return /** @type {LocalizedString} */ (`Informe um horário.`);
		if (i?.field === "members") return /** @type {LocalizedString} */ (`Adicione pelo menos uma pessoa.`);
		if (i?.field === "user") return /** @type {LocalizedString} */ (`Escolha quem vai cobrir.`);
		if (i?.field === "start") return /** @type {LocalizedString} */ (`Informe quando a substituição começa.`);
		return /** @type {LocalizedString} */ (`Termine depois do início, no futuro, em até 90 dias.`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Enter a name, up to 80 characters.`);
		if (i?.field === "time_zone") return /** @type {LocalizedString} */ (`Choose a time zone.`);
		if (i?.field === "layer_name") return /** @type {LocalizedString} */ (`Enter a layer name, up to 60 characters.`);
		if (i?.field === "start_date") return /** @type {LocalizedString} */ (`Enter a date from 2000 to 2099.`);
		if (i?.field === "handoff_time") return /** @type {LocalizedString} */ (`Enter a time.`);
		if (i?.field === "members") return /** @type {LocalizedString} */ (`Add at least one person.`);
		if (i?.field === "user") return /** @type {LocalizedString} */ (`Choose who covers.`);
		if (i?.field === "start") return /** @type {LocalizedString} */ (`Enter when the override starts.`);
		return /** @type {LocalizedString} */ (`End after the start, in the future, at most 90 days later.`)
	}
});