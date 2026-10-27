/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown>, form: NonNullable<unknown> }} Catalog_FieldInputs */



/**
* | field | form | output |
* | --- | --- | --- |
* | "name" | "label" | "Name" |
* | "description" | "label" | "Description (optional)" |
* | "tier" | "label" | "Criticality" |
* | "owners" | "label" | "Owners" |
* | "add_owner" | "label" | "Add a schedule or a person" |
* | "policy" | "label" | "Escalation policy" |
* | "severity" | "label" | "Default severity" |
* | "required" | "label" | "Required fields" |
* | "kind" | "label" | "Kind" |
* | "options" | "label" | "Options" |
* | "value" | "label" | "Value" |
* | "name" | "invalid" | "Enter a name." |
* | "description" | "invalid" | "Use at most 500 characters, without hidden characters." |
* | "options" | "invalid" | "Give every option a name, each one different." |
* | "text" | "invalid" | "Use 1 to 500 characters, without hidden characters." |
* | "number" | "invalid" | "Enter a number." |
* | "link" | "invalid" | "Enter a link that starts with https:// or http://." |
* | "choice" | "invalid" | "Pick at least one option." |
* | * | "invalid" | "Check this field." |
* | * | * | "Field" |
*
* @param {Catalog_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_field = /** @type {((inputs: Catalog_FieldInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_FieldInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name" && i?.form === "label") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.field === "description" && i?.form === "label") return /** @type {LocalizedString} */ (`Descrição (opcional)`);
		if (i?.field === "tier" && i?.form === "label") return /** @type {LocalizedString} */ (`Criticidade`);
		if (i?.field === "owners" && i?.form === "label") return /** @type {LocalizedString} */ (`Responsáveis`);
		if (i?.field === "add_owner" && i?.form === "label") return /** @type {LocalizedString} */ (`Adicionar uma escala ou uma pessoa`);
		if (i?.field === "policy" && i?.form === "label") return /** @type {LocalizedString} */ (`Política de escalonamento`);
		if (i?.field === "severity" && i?.form === "label") return /** @type {LocalizedString} */ (`Severidade padrão`);
		if (i?.field === "required" && i?.form === "label") return /** @type {LocalizedString} */ (`Campos obrigatórios`);
		if (i?.field === "kind" && i?.form === "label") return /** @type {LocalizedString} */ (`Tipo de campo`);
		if (i?.field === "options" && i?.form === "label") return /** @type {LocalizedString} */ (`Opções`);
		if (i?.field === "value" && i?.form === "label") return /** @type {LocalizedString} */ (`Valor`);
		if (i?.field === "name" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Informe um nome.`);
		if (i?.field === "description" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Use no máximo 500 caracteres, sem caracteres ocultos.`);
		if (i?.field === "options" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Dê um nome a cada opção, todos diferentes.`);
		if (i?.field === "text" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Use de 1 a 500 caracteres, sem caracteres ocultos.`);
		if (i?.field === "number" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Informe um número.`);
		if (i?.field === "link" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Informe um link que comece com https:// ou http://.`);
		if (i?.field === "choice" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Escolha ao menos uma opção.`);
		if (i?.form === "invalid") return /** @type {LocalizedString} */ (`Confira este campo.`);
		return /** @type {LocalizedString} */ (`Campo`)
	}
	{
		if (i?.field === "name" && i?.form === "label") return /** @type {LocalizedString} */ (`Name`);
		if (i?.field === "description" && i?.form === "label") return /** @type {LocalizedString} */ (`Description (optional)`);
		if (i?.field === "tier" && i?.form === "label") return /** @type {LocalizedString} */ (`Criticality`);
		if (i?.field === "owners" && i?.form === "label") return /** @type {LocalizedString} */ (`Owners`);
		if (i?.field === "add_owner" && i?.form === "label") return /** @type {LocalizedString} */ (`Add a schedule or a person`);
		if (i?.field === "policy" && i?.form === "label") return /** @type {LocalizedString} */ (`Escalation policy`);
		if (i?.field === "severity" && i?.form === "label") return /** @type {LocalizedString} */ (`Default severity`);
		if (i?.field === "required" && i?.form === "label") return /** @type {LocalizedString} */ (`Required fields`);
		if (i?.field === "kind" && i?.form === "label") return /** @type {LocalizedString} */ (`Kind`);
		if (i?.field === "options" && i?.form === "label") return /** @type {LocalizedString} */ (`Options`);
		if (i?.field === "value" && i?.form === "label") return /** @type {LocalizedString} */ (`Value`);
		if (i?.field === "name" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Enter a name.`);
		if (i?.field === "description" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Use at most 500 characters, without hidden characters.`);
		if (i?.field === "options" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Give every option a name, each one different.`);
		if (i?.field === "text" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Use 1 to 500 characters, without hidden characters.`);
		if (i?.field === "number" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Enter a number.`);
		if (i?.field === "link" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Enter a link that starts with https:// or http://.`);
		if (i?.field === "choice" && i?.form === "invalid") return /** @type {LocalizedString} */ (`Pick at least one option.`);
		if (i?.form === "invalid") return /** @type {LocalizedString} */ (`Check this field.`);
		return /** @type {LocalizedString} */ (`Field`)
	}
});