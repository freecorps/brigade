/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ count: NonNullable<unknown>, workspace: NonNullable<unknown> }} Email_Reminder_IntroInputs */



/**
* | countPlural | output |
* | --- | --- |
* | "one" | "You have {countFormatted} open follow-up due today or overdue in {workspace}:" |
* | * | "You have {countFormatted} open follow-ups due today or overdue in {workspace}:" |
*
* @param {Email_Reminder_IntroInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_reminder_intro = /** @type {((inputs: Email_Reminder_IntroInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_Reminder_IntroInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Você tem ${countFormatted} ação de acompanhamento aberta com prazo hoje ou atrasada em ${i?.workspace}:`);
		return /** @type {LocalizedString} */ (`Você tem ${countFormatted} ações de acompanhamento abertas com prazo hoje ou atrasadas em ${i?.workspace}:`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`You have ${countFormatted} open follow-up due today or overdue in ${i?.workspace}:`);
		return /** @type {LocalizedString} */ (`You have ${countFormatted} open follow-ups due today or overdue in ${i?.workspace}:`)
	}
});