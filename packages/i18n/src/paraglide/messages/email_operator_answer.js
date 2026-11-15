/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, answer: NonNullable<unknown> }} Email_Operator_AnswerInputs */



/**
* | output |
* | --- |
* | "{reason} The check's answer: {answer}." |
*
* @param {Email_Operator_AnswerInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_operator_answer = /** @type {((inputs: Email_Operator_AnswerInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Operator_AnswerInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`${i?.reason} Resposta da verificação: ${i?.answer}.`)
	return /** @type {LocalizedString} */ (`${i?.reason} The check's answer: ${i?.answer}.`)
});