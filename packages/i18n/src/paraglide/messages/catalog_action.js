/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown> }} Catalog_ActionInputs */



/**
* | action | output |
* | --- | --- |
* | "add_service" | "New service" |
* | "add_type" | "New type" |
* | "add_field" | "New field" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "create_service" | "Create service" |
* | "create_type" | "Create type" |
* | "create_field" | "Create field" |
* | "cancel" | "Cancel" |
* | "delete_service" | "Delete service" |
* | "delete_type" | "Delete type" |
* | "delete_field" | "Delete field" |
* | "delete" | "Delete" |
* | "add_option" | "Add an option" |
* | "clear" | "Clear" |
* | "open" | "Open" |
* | "add_role" | "New role" |
* | "create_role" | "Create role" |
* | "delete_role" | "Delete role" |
* | "remove_role" | "Remove role" |
* | "restore" | "Restore" |
* | "add_item" | "Add a responsibility" |
* | * | "Change" |
*
* @param {Catalog_ActionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_action = /** @type {((inputs: Catalog_ActionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_ActionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "add_service") return /** @type {LocalizedString} */ (`Novo serviço`);
		if (i?.action === "add_type") return /** @type {LocalizedString} */ (`Novo tipo`);
		if (i?.action === "add_field") return /** @type {LocalizedString} */ (`Novo campo`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.action === "create_service") return /** @type {LocalizedString} */ (`Criar serviço`);
		if (i?.action === "create_type") return /** @type {LocalizedString} */ (`Criar tipo`);
		if (i?.action === "create_field") return /** @type {LocalizedString} */ (`Criar campo`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.action === "delete_service") return /** @type {LocalizedString} */ (`Excluir serviço`);
		if (i?.action === "delete_type") return /** @type {LocalizedString} */ (`Excluir tipo`);
		if (i?.action === "delete_field") return /** @type {LocalizedString} */ (`Excluir campo`);
		if (i?.action === "delete") return /** @type {LocalizedString} */ (`Excluir`);
		if (i?.action === "add_option") return /** @type {LocalizedString} */ (`Adicionar uma opção`);
		if (i?.action === "clear") return /** @type {LocalizedString} */ (`Limpar`);
		if (i?.action === "open") return /** @type {LocalizedString} */ (`Abrir`);
		if (i?.action === "add_role") return /** @type {LocalizedString} */ (`Novo papel`);
		if (i?.action === "create_role") return /** @type {LocalizedString} */ (`Criar papel`);
		if (i?.action === "delete_role") return /** @type {LocalizedString} */ (`Excluir papel`);
		if (i?.action === "remove_role") return /** @type {LocalizedString} */ (`Remover papel`);
		if (i?.action === "restore") return /** @type {LocalizedString} */ (`Restaurar`);
		if (i?.action === "add_item") return /** @type {LocalizedString} */ (`Adicionar uma responsabilidade`);
		return /** @type {LocalizedString} */ (`Alterar`)
	}
	{
		if (i?.action === "add_service") return /** @type {LocalizedString} */ (`New service`);
		if (i?.action === "add_type") return /** @type {LocalizedString} */ (`New type`);
		if (i?.action === "add_field") return /** @type {LocalizedString} */ (`New field`);
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.action === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.action === "create_service") return /** @type {LocalizedString} */ (`Create service`);
		if (i?.action === "create_type") return /** @type {LocalizedString} */ (`Create type`);
		if (i?.action === "create_field") return /** @type {LocalizedString} */ (`Create field`);
		if (i?.action === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.action === "delete_service") return /** @type {LocalizedString} */ (`Delete service`);
		if (i?.action === "delete_type") return /** @type {LocalizedString} */ (`Delete type`);
		if (i?.action === "delete_field") return /** @type {LocalizedString} */ (`Delete field`);
		if (i?.action === "delete") return /** @type {LocalizedString} */ (`Delete`);
		if (i?.action === "add_option") return /** @type {LocalizedString} */ (`Add an option`);
		if (i?.action === "clear") return /** @type {LocalizedString} */ (`Clear`);
		if (i?.action === "open") return /** @type {LocalizedString} */ (`Open`);
		if (i?.action === "add_role") return /** @type {LocalizedString} */ (`New role`);
		if (i?.action === "create_role") return /** @type {LocalizedString} */ (`Create role`);
		if (i?.action === "delete_role") return /** @type {LocalizedString} */ (`Delete role`);
		if (i?.action === "remove_role") return /** @type {LocalizedString} */ (`Remove role`);
		if (i?.action === "restore") return /** @type {LocalizedString} */ (`Restore`);
		if (i?.action === "add_item") return /** @type {LocalizedString} */ (`Add a responsibility`);
		return /** @type {LocalizedString} */ (`Change`)
	}
});