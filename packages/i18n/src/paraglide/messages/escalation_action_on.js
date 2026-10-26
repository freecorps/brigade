/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ action: NonNullable<unknown>, name: NonNullable<unknown> }} Escalation_Action_OnInputs */



/**
* | action | output |
* | --- | --- |
* | "edit" | "Edit {name}" |
* | "remove_target" | "Remove {name}" |
* | "remove_level" | "Remove {name}" |
* | * | "{name}" |
*
* @param {Escalation_Action_OnInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_action_on = /** @type {((inputs: Escalation_Action_OnInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Action_OnInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Editar ${i?.name}`);
		if (i?.action === "remove_target") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		if (i?.action === "remove_level") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
	{
		if (i?.action === "edit") return /** @type {LocalizedString} */ (`Edit ${i?.name}`);
		if (i?.action === "remove_target") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		if (i?.action === "remove_level") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
});