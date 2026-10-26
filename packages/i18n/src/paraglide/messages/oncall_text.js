/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, max: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_TextInputs */



/**
* | text | output |
* | --- | --- |
* | "your_time" | "{time} your time" |
* | "members_max" | "Up to {max} people per layer." |
* | "choose_person" | "Choose a person…" |
* | "remove_override" | "Remove {name}'s override?" |
* | * | "A later layer has someone at all times from this layer's start, so nobody in this one is ever on call." |
*
* @param {Oncall_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_text = /** @type {((inputs: Oncall_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.text === "your_time") return /** @type {LocalizedString} */ (`${i?.time} no seu horário`);
		if (i?.text === "members_max") return /** @type {LocalizedString} */ (`Até ${i?.max} pessoas por camada.`);
		if (i?.text === "choose_person") return /** @type {LocalizedString} */ (`Escolha uma pessoa…`);
		if (i?.text === "remove_override") return /** @type {LocalizedString} */ (`Remover a substituição de ${i?.name}?`);
		return /** @type {LocalizedString} */ (`Uma camada posterior tem alguém o tempo todo desde o início desta, então ninguém nesta fica de plantão.`)
	}
	{
		if (i?.text === "your_time") return /** @type {LocalizedString} */ (`${i?.time} your time`);
		if (i?.text === "members_max") return /** @type {LocalizedString} */ (`Up to ${i?.max} people per layer.`);
		if (i?.text === "choose_person") return /** @type {LocalizedString} */ (`Choose a person…`);
		if (i?.text === "remove_override") return /** @type {LocalizedString} */ (`Remove ${i?.name}'s override?`);
		return /** @type {LocalizedString} */ (`A later layer has someone at all times from this layer's start, so nobody in this one is ever on call.`)
	}
});