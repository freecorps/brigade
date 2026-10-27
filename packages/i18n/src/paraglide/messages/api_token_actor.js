/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown>, by: NonNullable<unknown> }} Api_Token_ActorInputs */



/**
* | output |
* | --- |
* | "API token {name} (by {by})" |
*
* @param {Api_Token_ActorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const api_token_actor = /** @type {((inputs: Api_Token_ActorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Api_Token_ActorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Token de API ${i?.name} (por ${i?.by})`)
	return /** @type {LocalizedString} */ (`API token ${i?.name} (by ${i?.by})`)
});