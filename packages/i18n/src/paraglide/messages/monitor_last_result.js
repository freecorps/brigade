/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ state: NonNullable<unknown>, name: NonNullable<unknown>, when: NonNullable<unknown> }} Monitor_Last_ResultInputs */



/**
* | state | output |
* | --- | --- |
* | "paused_you" | "Paused by you {when}" |
* | "paused_name" | "Paused by {name} {when}" |
* | "paused_other" | "Paused by a teammate {when}" |
* | * | "Last report {when}" |
*
* @param {Monitor_Last_ResultInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_last_result = /** @type {((inputs: Monitor_Last_ResultInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Last_ResultInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.state === "paused_you") return /** @type {LocalizedString} */ (`Pausado por você ${i?.when}`);
		if (i?.state === "paused_name") return /** @type {LocalizedString} */ (`Pausado por ${i?.name} ${i?.when}`);
		if (i?.state === "paused_other") return /** @type {LocalizedString} */ (`Pausado por outra pessoa ${i?.when}`);
		return /** @type {LocalizedString} */ (`Último relatório ${i?.when}`)
	}
	{
		if (i?.state === "paused_you") return /** @type {LocalizedString} */ (`Paused by you ${i?.when}`);
		if (i?.state === "paused_name") return /** @type {LocalizedString} */ (`Paused by ${i?.name} ${i?.when}`);
		if (i?.state === "paused_other") return /** @type {LocalizedString} */ (`Paused by a teammate ${i?.when}`);
		return /** @type {LocalizedString} */ (`Last report ${i?.when}`)
	}
});