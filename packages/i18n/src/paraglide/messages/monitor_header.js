/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_HeaderInputs */



/**
* | part | output |
* | --- | --- |
* | "add" | "Add header" |
* | "remove" | "Remove header {name}" |
* | "remove_unnamed" | "Remove this header" |
* | * | "Header" |
*
* @param {Monitor_HeaderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_header = /** @type {((inputs: Monitor_HeaderInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_HeaderInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar cabeçalho`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover cabeçalho ${i?.name}`);
		if (i?.part === "remove_unnamed") return /** @type {LocalizedString} */ (`Remover este cabeçalho`);
		return /** @type {LocalizedString} */ (`Cabeçalho`)
	}
	{
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add header`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove header ${i?.name}`);
		if (i?.part === "remove_unnamed") return /** @type {LocalizedString} */ (`Remove this header`);
		return /** @type {LocalizedString} */ (`Header`)
	}
});