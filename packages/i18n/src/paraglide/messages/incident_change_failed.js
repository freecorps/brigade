/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, role: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Change_FailedInputs */



/**
* | kind | output |
* | --- | --- |
* | "update" | "Couldn't post the update. {reason}" |
* | * | "Couldn't change the {role}. {reason}" |
*
* @param {Incident_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_change_failed = /** @type {((inputs: Incident_Change_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Change_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "update") return /** @type {LocalizedString} */ (`Não foi possível publicar a atualização. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Não foi possível alterar ${i?.role}. ${i?.reason}`)
	}
	{
		if (i?.kind === "update") return /** @type {LocalizedString} */ (`Couldn't post the update. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Couldn't change the ${i?.role}. ${i?.reason}`)
	}
});