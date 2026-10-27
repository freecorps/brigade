/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ monitors: NonNullable<unknown> }} Monitor_Check_ErrorsInputs */



/**
* | output |
* | --- |
* | "Brigade couldn't judge the latest checks of {monitors}: the body pattern took too long. They keep their last result and nobody is paged for it. Simplify the ..." |
*
* @param {Monitor_Check_ErrorsInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_check_errors = /** @type {((inputs: Monitor_Check_ErrorsInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Check_ErrorsInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`O Brigade não conseguiu avaliar as últimas verificações de ${i?.monitors}: o padrão do corpo demorou demais. Elas mantêm o último resultado e ninguém é chamado por isso. Simplifique o padrão para corrigir.`)
	return /** @type {LocalizedString} */ (`Brigade couldn't judge the latest checks of ${i?.monitors}: the body pattern took too long. They keep their last result and nobody is paged for it. Simplify the pattern to fix it.`)
});