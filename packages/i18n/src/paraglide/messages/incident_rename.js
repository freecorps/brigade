/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_RenameInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Rename" |
* | "label" | "Incident title" |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "invalid" | "Give it a title with visible characters." |
* | "failed" | "Couldn't rename it. {reason}" |
* | * | "Rename" |
*
* @param {Incident_RenameInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_rename = /** @type {((inputs: Incident_RenameInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_RenameInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Renomear`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Título do incidente`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Dê a ele um título com caracteres visíveis.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível renomeá-lo. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Renomear`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Rename`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Incident title`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Give it a title with visible characters.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't rename it. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Rename`)
	}
});