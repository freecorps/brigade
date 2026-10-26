/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Paging_UnknownInputs */



/**
* | output |
* | --- |
* | "The paging self-check hasn't run yet. Once it runs, a heartbeat goes through Brigade's event queue every minute and checks that the push relay accepts Brigad..." |
*
* @param {Paging_UnknownInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const paging_unknown = /** @type {((inputs?: Paging_UnknownInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Paging_UnknownInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("A autoverificação dos acionamentos ainda não rodou. Quando rodar, um sinal passa pela fila de eventos do Brigade a cada minuto e confere se o relay de push aceita o token do Brigade. Nada é enviado aos celulares.")
	return /** @type {LocalizedString} */ ("The paging self-check hasn't run yet. Once it runs, a heartbeat goes through Brigade's event queue every minute and checks that the push relay accepts Brigade's token. It doesn't send anything to phones.")
});