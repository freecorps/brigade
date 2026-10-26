/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Oncall_Layers_HintInputs */



/**
* | output |
* | --- |
* | "Layers stack: a later layer wins where it has someone on call. Handoffs follow the time zone's clock, also across daylight saving changes." |
*
* @param {Oncall_Layers_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_layers_hint = /** @type {((inputs?: Oncall_Layers_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Layers_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("As camadas se empilham: uma camada posterior prevalece onde tem alguém de plantão. As trocas seguem o relógio do fuso, inclusive nas mudanças de horário de verão.")
	return /** @type {LocalizedString} */ ("Layers stack: a later layer wins where it has someone on call. Handoffs follow the time zone's clock, also across daylight saving changes.")
});