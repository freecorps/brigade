/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Catalog_Action_OnInputs */



/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "remove" | "Remove {name}" |
* | "clear" | "Clear {name}" |
* | "option" | "Option {name}" |
* | "restore" | "Restore {name}" |
* | "item" | "Responsibility {name}" |
* | * | "{name}" |
*
* @param {Catalog_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_action_on = /** @type {((inputs: Catalog_Action_OnInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_Action_OnInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar ${i?.name}`);
		if (i?.action === "remove") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		if (i?.action === "clear") return /** @type {LocalizedString} */ (`Limpar ${i?.name}`);
		if (i?.action === "option") return /** @type {LocalizedString} */ (`Opção ${i?.name}`);
		if (i?.action === "restore") return /** @type {LocalizedString} */ (`Restaurar ${i?.name}`);
		if (i?.action === "item") return /** @type {LocalizedString} */ (`Responsabilidade ${i?.name}`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
	{
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit ${i?.name}`);
		if (i?.action === "remove") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		if (i?.action === "clear") return /** @type {LocalizedString} */ (`Clear ${i?.name}`);
		if (i?.action === "option") return /** @type {LocalizedString} */ (`Option ${i?.name}`);
		if (i?.action === "restore") return /** @type {LocalizedString} */ (`Restore ${i?.name}`);
		if (i?.action === "item") return /** @type {LocalizedString} */ (`Responsibility ${i?.name}`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
});