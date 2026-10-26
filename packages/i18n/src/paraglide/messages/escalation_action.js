/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Escalation_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "add_policy" | "New policy" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "create" | "Create policy" |
* | "cancel" | "Cancel" |
* | "delete_policy" | "Delete policy" |
* | "delete" | "Delete" |
* | "add_level" | "Add a level" |
* | "remove_level" | "Remove level" |
* | "remove_target" | "Remove" |
* | "move_up" | "Move up" |
* | "move_down" | "Move down" |
* | * | "Change" |
*
* @param {Escalation_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_action = /** @type {((inputs: Escalation_ActionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_ActionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "add_policy") return /** @type {LocalizedString} */ (`Nova política`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.action === "create") return /** @type {LocalizedString} */ (`Criar política`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.action === "delete_policy") return /** @type {LocalizedString} */ (`Excluir política`);
		if (i?.action === "delete") return /** @type {LocalizedString} */ (`Excluir`);
		if (i?.action === "add_level") return /** @type {LocalizedString} */ (`Adicionar um nível`);
		if (i?.action === "remove_level") return /** @type {LocalizedString} */ (`Remover nível`);
		if (i?.action === "remove_target") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.action === "move_up") return /** @type {LocalizedString} */ (`Mover para cima`);
		if (i?.action === "move_down") return /** @type {LocalizedString} */ (`Mover para baixo`);
		return /** @type {LocalizedString} */ (`Alterar`)
	}
	{
		if (i?.action === "add_policy") return /** @type {LocalizedString} */ (`New policy`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.action === "create") return /** @type {LocalizedString} */ (`Create policy`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.action === "delete_policy") return /** @type {LocalizedString} */ (`Delete policy`);
		if (i?.action === "delete") return /** @type {LocalizedString} */ (`Delete`);
		if (i?.action === "add_level") return /** @type {LocalizedString} */ (`Add a level`);
		if (i?.action === "remove_level") return /** @type {LocalizedString} */ (`Remove level`);
		if (i?.action === "remove_target") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.action === "move_up") return /** @type {LocalizedString} */ (`Move up`);
		if (i?.action === "move_down") return /** @type {LocalizedString} */ (`Move down`);
		return /** @type {LocalizedString} */ (`Change`)
	}
});