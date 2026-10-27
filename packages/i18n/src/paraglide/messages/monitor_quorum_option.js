/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown>, total: NonNullable<unknown> }} Monitor_Quorum_OptionInputs */



/**
* | kind | output |
* | --- | --- |
* | "majority" | "Majority (default)" |
* | * | "{count} of {total}" |
*
* @param {Monitor_Quorum_OptionInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_quorum_option = /** @type {((inputs: Monitor_Quorum_OptionInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Quorum_OptionInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "majority") return /** @type {LocalizedString} */ (`Maioria (padrão)`);
		return /** @type {LocalizedString} */ (`${i?.count} de ${i?.total}`)
	}
	{
		if (i?.kind === "majority") return /** @type {LocalizedString} */ (`Majority (default)`);
		return /** @type {LocalizedString} */ (`${i?.count} of ${i?.total}`)
	}
});