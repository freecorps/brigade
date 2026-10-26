/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Escalation_Delete_ConfirmInputs */



/**
* | output |
* | --- |
* | "Delete {name}? Runs under way keep the levels they started with." |
*
* @param {Escalation_Delete_ConfirmInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_delete_confirm = /** @type {((inputs: Escalation_Delete_ConfirmInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Delete_ConfirmInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Escalonamentos em andamento mantêm os níveis com que começaram.`)
	return /** @type {LocalizedString} */ (`Delete ${i?.name}? Runs under way keep the levels they started with.`)
});