/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_PolicyInputs */



/**
* | kind | output |
* | --- | --- |
* | "own" | "Pages through {name}" |
* | "default" | "Pages through {name} (default)" |
* | "none" | "No escalation policy" |
* | "option_default" | "Workspace default ({name})" |
* | "option_none" | "Workspace default (none set)" |
* | * | "{name}" |
*
* @param {Monitor_PolicyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_policy = /** @type {((inputs: Monitor_PolicyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_PolicyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "own") return /** @type {LocalizedString} */ (`Chama por ${i?.name}`);
		if (i?.kind === "default") return /** @type {LocalizedString} */ (`Chama por ${i?.name} (padrão)`);
		if (i?.kind === "none") return /** @type {LocalizedString} */ (`Sem política de escalonamento`);
		if (i?.kind === "option_default") return /** @type {LocalizedString} */ (`Padrão do workspace (${i?.name})`);
		if (i?.kind === "option_none") return /** @type {LocalizedString} */ (`Padrão do workspace (nenhuma definida)`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
	{
		if (i?.kind === "own") return /** @type {LocalizedString} */ (`Pages through ${i?.name}`);
		if (i?.kind === "default") return /** @type {LocalizedString} */ (`Pages through ${i?.name} (default)`);
		if (i?.kind === "none") return /** @type {LocalizedString} */ (`No escalation policy`);
		if (i?.kind === "option_default") return /** @type {LocalizedString} */ (`Workspace default (${i?.name})`);
		if (i?.kind === "option_none") return /** @type {LocalizedString} */ (`Workspace default (none set)`);
		return /** @type {LocalizedString} */ (`${i?.name}`)
	}
});