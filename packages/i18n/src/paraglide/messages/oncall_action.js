/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Oncall_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "add_schedule" | "Add schedule" |
* | "add_override" | "Add override" |
* | "add_layer" | "Add layer" |
* | "edit" | "Edit" |
* | "create" | "Create schedule" |
* | "save" | "Save changes" |
* | "cancel" | "Cancel" |
* | "delete_schedule" | "Delete schedule" |
* | * | "Delete" |
*
* @param {Oncall_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_action = /** @type {((inputs: Oncall_ActionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_ActionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "add_schedule") return /** @type {LocalizedString} */ (`Adicionar escala`);
		if (i?.action === "add_override") return /** @type {LocalizedString} */ (`Adicionar substituição`);
		if (i?.action === "add_layer") return /** @type {LocalizedString} */ (`Adicionar camada`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.action === "create") return /** @type {LocalizedString} */ (`Criar escala`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Salvar alterações`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.action === "delete_schedule") return /** @type {LocalizedString} */ (`Excluir escala`);
		return /** @type {LocalizedString} */ (`Excluir`)
	}
	{
		if (i?.action === "add_schedule") return /** @type {LocalizedString} */ (`Add schedule`);
		if (i?.action === "add_override") return /** @type {LocalizedString} */ (`Add override`);
		if (i?.action === "add_layer") return /** @type {LocalizedString} */ (`Add layer`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.action === "create") return /** @type {LocalizedString} */ (`Create schedule`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Save changes`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.action === "delete_schedule") return /** @type {LocalizedString} */ (`Delete schedule`);
		return /** @type {LocalizedString} */ (`Delete`)
	}
});