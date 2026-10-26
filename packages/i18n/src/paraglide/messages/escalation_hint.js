/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escalation_HintInputs */



/**
* | output |
* | --- |
* | "Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once." |
*
* @param {Escalation_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_hint = /** @type {((inputs?: Escalation_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("Os níveis chamam em ordem até alguém confirmar. Uma escala chama quem estiver de plantão quando o nível dispara; um nível em que ninguém pode ser alcançado é pulado na hora.")
	return /** @type {LocalizedString} */ ("Levels page in order until someone acknowledges. A schedule pages whoever is on call when its level fires; a level nobody can be reached at is skipped at once.")
});