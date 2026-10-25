/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, got: NonNullable<unknown>, expected: NonNullable<unknown> }} Monitor_Check_ErrorInputs */



/**
* | reason | output |
* | --- | --- |
* | "timeout" | "Timed out" |
* | "network" | "Couldn't connect" |
* | "blocked" | "Address not allowed" |
* | "status" | "Got {got}, expected {expected}" |
* | "status_any" | "Got {got}, expected 2xx or 3xx" |
* | "keyword" | "Text not found" |
* | "missed" | "No ping in time" |
* | * | "Check failed" |
*
* @param {Monitor_Check_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_check_error = /** @type {((inputs: Monitor_Check_ErrorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Check_ErrorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.reason === "timeout") return /** @type {LocalizedString} */ (`Tempo esgotado`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Não conectou`);
		if (i?.reason === "blocked") return /** @type {LocalizedString} */ (`Endereço não permitido`);
		if (i?.reason === "status") return /** @type {LocalizedString} */ (`Recebeu ${i?.got}, esperava ${i?.expected}`);
		if (i?.reason === "status_any") return /** @type {LocalizedString} */ (`Recebeu ${i?.got}, esperava 2xx ou 3xx`);
		if (i?.reason === "keyword") return /** @type {LocalizedString} */ (`Texto não encontrado`);
		if (i?.reason === "missed") return /** @type {LocalizedString} */ (`Nenhum sinal a tempo`);
		return /** @type {LocalizedString} */ (`A verificação falhou`)
	}
	{
		if (i?.reason === "timeout") return /** @type {LocalizedString} */ (`Timed out`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Couldn't connect`);
		if (i?.reason === "blocked") return /** @type {LocalizedString} */ (`Address not allowed`);
		if (i?.reason === "status") return /** @type {LocalizedString} */ (`Got ${i?.got}, expected ${i?.expected}`);
		if (i?.reason === "status_any") return /** @type {LocalizedString} */ (`Got ${i?.got}, expected 2xx or 3xx`);
		if (i?.reason === "keyword") return /** @type {LocalizedString} */ (`Text not found`);
		if (i?.reason === "missed") return /** @type {LocalizedString} */ (`No ping in time`);
		return /** @type {LocalizedString} */ (`Check failed`)
	}
});