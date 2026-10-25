/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Monitors_EmptyInputs */



/**
* | output |
* | --- |
* | "Nothing is watched yet. Add an HTTP check, or a heartbeat for jobs that should check in." |
*
* @param {Monitors_EmptyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitors_empty = /** @type {((inputs?: Monitors_EmptyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitors_EmptyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Nada é monitorado ainda. Adicione uma verificação HTTP, ou um heartbeat para tarefas que devem dar sinal de vida.")
	return /** @type {LocalizedString} */ ("Nothing is watched yet. Add an HTTP check, or a heartbeat for jobs that should check in.")
});