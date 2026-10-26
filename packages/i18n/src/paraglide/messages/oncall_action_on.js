/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Oncall_Action_OnInputs */



/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "add_override" | "Add override to {name}" |
* | "remove_override" | "Remove override for {name}" |
* | "remove_layer" | "Remove layer {name}" |
* | "up" | "Move {name} up" |
* | "down" | "Move {name} down" |
* | * | "Remove {name} from the layer" |
*
* @param {Oncall_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_action_on = /** @type {((inputs: Oncall_Action_OnInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_Action_OnInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar ${i?.name}`);
		if (i?.action === "add_override") return /** @type {LocalizedString} */ (`Adicionar substituição em ${i?.name}`);
		if (i?.action === "remove_override") return /** @type {LocalizedString} */ (`Remover a substituição de ${i?.name}`);
		if (i?.action === "remove_layer") return /** @type {LocalizedString} */ (`Remover a camada ${i?.name}`);
		if (i?.action === "up") return /** @type {LocalizedString} */ (`Subir ${i?.name}`);
		if (i?.action === "down") return /** @type {LocalizedString} */ (`Descer ${i?.name}`);
		return /** @type {LocalizedString} */ (`Tirar ${i?.name} da camada`)
	}
	{
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit ${i?.name}`);
		if (i?.action === "add_override") return /** @type {LocalizedString} */ (`Add override to ${i?.name}`);
		if (i?.action === "remove_override") return /** @type {LocalizedString} */ (`Remove override for ${i?.name}`);
		if (i?.action === "remove_layer") return /** @type {LocalizedString} */ (`Remove layer ${i?.name}`);
		if (i?.action === "up") return /** @type {LocalizedString} */ (`Move ${i?.name} up`);
		if (i?.action === "down") return /** @type {LocalizedString} */ (`Move ${i?.name} down`);
		return /** @type {LocalizedString} */ (`Remove ${i?.name} from the layer`)
	}
});