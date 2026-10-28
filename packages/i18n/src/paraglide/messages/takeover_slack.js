/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ team: NonNullable<unknown> }} Takeover_SlackInputs */



/**
* | output |
* | --- |
* | "Slack disconnected from {team}" |
*
* @param {Takeover_SlackInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const takeover_slack = /** @type {((inputs: Takeover_SlackInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_SlackInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Slack desconectado de ${i?.team}`)
	return /** @type {LocalizedString} */ (`Slack disconnected from ${i?.team}`)
});