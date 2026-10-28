/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Oncall_Gaps_HintInputs */



/**
* | part | output |
* | --- | --- |
* | "manage" | "An empty layer has nobody on call unless another layer covers it. Edit the schedule to add someone, or remove the layer." |
* | * | "An empty layer has nobody on call unless another layer covers it. Ask an owner or admin to add someone." |
*
* @param {Oncall_Gaps_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_gaps_hint = /** @type {((inputs: Oncall_Gaps_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Gaps_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "manage") return /** @type {LocalizedString} */ (`Uma camada vazia não tem ninguém de plantão, a não ser que outra camada cubra. Edite a escala para adicionar alguém, ou remova a camada.`);
		return /** @type {LocalizedString} */ (`Uma camada vazia não tem ninguém de plantão, a não ser que outra camada cubra. Peça a um proprietário ou admin para adicionar alguém.`)
	}
	{
		if (i?.part === "manage") return /** @type {LocalizedString} */ (`An empty layer has nobody on call unless another layer covers it. Edit the schedule to add someone, or remove the layer.`);
		return /** @type {LocalizedString} */ (`An empty layer has nobody on call unless another layer covers it. Ask an owner or admin to add someone.`)
	}
});