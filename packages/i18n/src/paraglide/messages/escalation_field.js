/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown>, form: NonNullable<unknown> }} Escalation_FieldInputs */



/**
* | field | form | output |
* | --- | --- | --- |
* | "name" | "label" | "Name" |
* | "timeout" | "label" | "Minutes before the next level" |
* | "timeout_last" | "label" | "Minutes before paging everyone who can respond" |
* | "repeat" | "label" | "Repeat the levels" |
* | "targets" | "label" | "Who is paged" |
* | "default" | "label" | "Use for every page (default policy)" |
* | "min_severity" | "label" | "Escalate from" |
* | "min_severity" | "hint" | "Less severe incidents page the first level once and don't escalate." |
* | "add_target" | "label" | "Add a schedule or a person" |
* | "name" | "invalid" | "Enter a name." |
* | "timeout" | "invalid" | "Enter a whole number of minutes from 1 to 1440." |
* | "targets" | "invalid" | "Add at least one schedule or person." |
* | * | "invalid" | "Check this field." |
* | * | * | "Field" |
*
* @param {Escalation_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_field = /** @type {((inputs: Escalation_FieldInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_FieldInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name" && i?.form === "label") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.field === "timeout" && i?.form === "label") return /** @type {LocalizedString} */ (`Minutos até o próximo nível`);
		if (i?.field === "timeout_last" && i?.form === "label") return /** @type {LocalizedString} */ (`Minutos antes de chamar todos que podem responder`);
		if (i?.field === "repeat" && i?.form === "label") return /** @type {LocalizedString} */ (`Repetir os níveis`);
		if (i?.field === "targets" && i?.form === "label") return /** @type {LocalizedString} */ (`Quem é chamado`);
		if (i?.field === "default" && i?.form === "label") return /** @type {LocalizedString} */ (`Usar em toda chamada (política padrão)`);
		if (i?.field === "min_severity" && i?.form === "label") return /** @type {LocalizedString} */ (`Escalar a partir de`);
		if (i?.field === "min_severity" && i?.form === "hint") return /** @type {LocalizedString} */ (`Incidentes menos graves chamam o primeiro nível uma vez e não escalam.`);
		if (i?.field === "add_target" && i?.form === "label") return /** @type {LocalizedString} */ (`Adicionar uma escala ou pessoa`);
		if (i?.field === "name" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Informe um nome.`);
		if (i?.field === "timeout" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Informe um número inteiro de minutos de 1 a 1440.`);
		if (i?.field === "targets" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Adicione pelo menos uma escala ou pessoa.`);
		if (i?.form === "invalid") return /** @type {LocalizedString} */ (`Confira este campo.`);
		return /** @type {LocalizedString} */ (`Campo`)
	}
	{
		if (i?.field === "name" && i?.form === "label") return /** @type {LocalizedString} */ (`Name`);
		if (i?.field === "timeout" && i?.form === "label") return /** @type {LocalizedString} */ (`Minutes before the next level`);
		if (i?.field === "timeout_last" && i?.form === "label") return /** @type {LocalizedString} */ (`Minutes before paging everyone who can respond`);
		if (i?.field === "repeat" && i?.form === "label") return /** @type {LocalizedString} */ (`Repeat the levels`);
		if (i?.field === "targets" && i?.form === "label") return /** @type {LocalizedString} */ (`Who is paged`);
		if (i?.field === "default" && i?.form === "label") return /** @type {LocalizedString} */ (`Use for every page (default policy)`);
		if (i?.field === "min_severity" && i?.form === "label") return /** @type {LocalizedString} */ (`Escalate from`);
		if (i?.field === "min_severity" && i?.form === "hint") return /** @type {LocalizedString} */ (`Less severe incidents page the first level once and don't escalate.`);
		if (i?.field === "add_target" && i?.form === "label") return /** @type {LocalizedString} */ (`Add a schedule or a person`);
		if (i?.field === "name" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Enter a name.`);
		if (i?.field === "timeout" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Enter a whole number of minutes from 1 to 1440.`);
		if (i?.field === "targets" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Add at least one schedule or person.`);
		if (i?.form === "invalid") return /** @type {LocalizedString} */ (`Check this field.`);
		return /** @type {LocalizedString} */ (`Field`)
	}
});