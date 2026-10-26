/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Oncall_Delete_ConfirmInputs */



/**
* | output |
* | --- |
* | "Delete {name}? Its overrides are deleted with it." |
*
* @param {Oncall_Delete_ConfirmInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_delete_confirm = /** @type {((inputs: Oncall_Delete_ConfirmInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Delete_ConfirmInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? As substituições dela são excluídas junto.`)
	return /** @type {LocalizedString} */ (`Delete ${i?.name}? Its overrides are deleted with it.`)
});