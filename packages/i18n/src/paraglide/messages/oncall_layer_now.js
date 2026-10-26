/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ state: NonNullable<unknown>, name: NonNullable<unknown> }} Oncall_Layer_NowInputs */



/**
* | state | output |
* | --- | --- |
* | "active" | "Now: {name}" |
* | "hidden" | "Now: {name}, hidden by a later layer" |
* | "overridden" | "Now: {name}, covered by an override" |
* | * | "Starts {name}" |
*
* @param {Oncall_Layer_NowInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layer_now = /** @type {((inputs: Oncall_Layer_NowInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layer_NowInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.state === "active") return /** @type {LocalizedString} */ (`Agora: ${i?.name}`);
		if (i?.state === "hidden") return /** @type {LocalizedString} */ (`Agora: ${i?.name}, mas uma camada posterior tem prioridade`);
		if (i?.state === "overridden") return /** @type {LocalizedString} */ (`Agora: ${i?.name}, mas uma substituição tem prioridade`);
		return /** @type {LocalizedString} */ (`Começa ${i?.name}`)
	}
	{
		if (i?.state === "active") return /** @type {LocalizedString} */ (`Now: ${i?.name}`);
		if (i?.state === "hidden") return /** @type {LocalizedString} */ (`Now: ${i?.name}, hidden by a later layer`);
		if (i?.state === "overridden") return /** @type {LocalizedString} */ (`Now: ${i?.name}, covered by an override`);
		return /** @type {LocalizedString} */ (`Starts ${i?.name}`)
	}
});