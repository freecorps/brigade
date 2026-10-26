/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Escalation_FieldInputs */



/**
* | field | output |
* | --- | --- |
* | "name" | "Name" |
* | "timeout" | "Minutes before the next level" |
* | "repeat" | "Repeat the levels" |
* | "targets" | "Who is paged" |
* | "default" | "Use for every page (default policy)" |
* | "add_target" | "Add a schedule or a person" |
* | * | "Field" |
*
* @param {Escalation_FieldInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_field = /** @type {((inputs: Escalation_FieldInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_FieldInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Minutos até o próximo nível`);
		if (i?.field === "repeat") return /** @type {LocalizedString} */ (`Repetir os níveis`);
		if (i?.field === "targets") return /** @type {LocalizedString} */ (`Quem é chamado`);
		if (i?.field === "default") return /** @type {LocalizedString} */ (`Usar em toda chamada (política padrão)`);
		if (i?.field === "add_target") return /** @type {LocalizedString} */ (`Adicionar uma escala ou pessoa`);
		return /** @type {LocalizedString} */ (`Campo`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Name`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Minutes before the next level`);
		if (i?.field === "repeat") return /** @type {LocalizedString} */ (`Repeat the levels`);
		if (i?.field === "targets") return /** @type {LocalizedString} */ (`Who is paged`);
		if (i?.field === "default") return /** @type {LocalizedString} */ (`Use for every page (default policy)`);
		if (i?.field === "add_target") return /** @type {LocalizedString} */ (`Add a schedule or a person`);
		return /** @type {LocalizedString} */ (`Field`)
	}
});