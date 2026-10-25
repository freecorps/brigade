/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ actor: NonNullable<unknown>, body: NonNullable<unknown> }} Incident_Update_AnnouncedInputs */



/**
* | output |
* | --- |
* | "{actor} posted an update: {body}" |
*
* @param {Incident_Update_AnnouncedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_update_announced = /** @type {((inputs: Incident_Update_AnnouncedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_AnnouncedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ (`${i?.actor} publicou uma atualização: ${i?.body}`)
	return /** @type {LocalizedString} */ (`${i?.actor} posted an update: ${i?.body}`)
});