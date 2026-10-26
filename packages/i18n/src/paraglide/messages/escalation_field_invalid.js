/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Escalation_Field_InvalidInputs */



/**
* | field | output |
* | --- | --- |
* | "name" | "Enter a name." |
* | "timeout" | "Enter a whole number of minutes from 1 to 1440." |
* | "repeat" | "Enter a whole number from 0 to 9." |
* | "targets" | "Add at least one schedule or person." |
* | * | "Check this field." |
*
* @param {Escalation_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_field_invalid = /** @type {((inputs: Escalation_Field_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Field_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Informe um nome.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Informe um número inteiro de minutos de 1 a 1440.`);
		if (i?.field === "repeat") return /** @type {LocalizedString} */ (`Informe um número inteiro de 0 a 9.`);
		if (i?.field === "targets") return /** @type {LocalizedString} */ (`Adicione pelo menos uma escala ou pessoa.`);
		return /** @type {LocalizedString} */ (`Confira este campo.`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Enter a name.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Enter a whole number of minutes from 1 to 1440.`);
		if (i?.field === "repeat") return /** @type {LocalizedString} */ (`Enter a whole number from 0 to 9.`);
		if (i?.field === "targets") return /** @type {LocalizedString} */ (`Add at least one schedule or person.`);
		return /** @type {LocalizedString} */ (`Check this field.`)
	}
});