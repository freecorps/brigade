/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown> }} Email_Reminder_MoreInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "And {countFormatted} more." |
* | * | "And {countFormatted} more." |
*
* @param {Email_Reminder_MoreInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_reminder_more = /** @type {((inputs: Email_Reminder_MoreInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Reminder_MoreInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`E mais ${countFormatted}.`);
		return /** @type {LocalizedString} */ (`E mais ${countFormatted}.`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`And ${countFormatted} more.`);
		return /** @type {LocalizedString} */ (`And ${countFormatted} more.`)
	}
});