/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ max: NonNullable<unknown> }} Monitor_Limit_ReachedInputs */



/**
* | output |
* | --- |
* | "This workspace has {max} monitors, the most it can have. Delete one to add another." |
*
* @param {Monitor_Limit_ReachedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_limit_reached = /** @type {((inputs: Monitor_Limit_ReachedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Limit_ReachedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`Este workspace já tem ${i?.max} monitores, o máximo possível. Exclua um para adicionar outro.`)
	return /** @type {LocalizedString} */ (`This workspace has ${i?.max} monitors, the most it can have. Delete one to add another.`)
});