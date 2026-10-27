/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Page_AgainInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Page again" |
* | "pending" | "Paging again…" |
* | "already" | "Someone already paged this again." |
* | "failed" | "Couldn't page again. {reason}" |
* | * | "Page again" |
*
* @param {Incident_Page_AgainInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_page_again = /** @type {((inputs: Incident_Page_AgainInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Page_AgainInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Chamar de novo`);
		if (i?.part === "pending") return /** @type {LocalizedString} */ (`Chamando de novo…`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Alguém já chamou de novo.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível chamar de novo. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Chamar de novo`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Page again`);
		if (i?.part === "pending") return /** @type {LocalizedString} */ (`Paging again…`);
		if (i?.part === "already") return /** @type {LocalizedString} */ (`Someone already paged this again.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't page again. ${i?.reason}`);
		return /** @type {LocalizedString} */ (`Page again`)
	}
});