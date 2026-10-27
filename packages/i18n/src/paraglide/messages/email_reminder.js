/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, title: NonNullable<unknown>, incident: NonNullable<unknown>, date: NonNullable<unknown> }} Email_ReminderInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "Follow-ups due in {workspace}" |
* | "item" | "{title} ({incident}), due {date}" |
* | "item_overdue" | "{title} ({incident}), overdue since {date}" |
* | "open" | "Open your follow-ups" |
* | "off" | "To stop these reminders, turn off Follow-up reminders in the Email card on the dashboard, or under Email in the Brigade app's account settings." |
* | "footer" | "You get this email because you own follow-ups in {workspace} on Brigade." |
* | * | "Follow-ups due in {workspace}" |
*
* @param {Email_ReminderInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_reminder = /** @type {((inputs: Email_ReminderInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_ReminderInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Ações de acompanhamento com prazo em ${i?.workspace}`);
		if (i?.part === "item") return /** @type {LocalizedString} */ (`${i?.title} (${i?.incident}), prazo ${i?.date}`);
		if (i?.part === "item_overdue") return /** @type {LocalizedString} */ (`${i?.title} (${i?.incident}), atrasada desde ${i?.date}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir suas ações de acompanhamento`);
		if (i?.part === "off") return /** @type {LocalizedString} */ (`Para parar estes lembretes, desative Lembretes de ações no cartão Email do painel, ou em Email nos ajustes de conta do app do Brigade.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Você está recebendo este email porque é responsável por ações de acompanhamento em ${i?.workspace} no Brigade.`);
		return /** @type {LocalizedString} */ (`Ações de acompanhamento com prazo em ${i?.workspace}`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`Follow-ups due in ${i?.workspace}`);
		if (i?.part === "item") return /** @type {LocalizedString} */ (`${i?.title} (${i?.incident}), due ${i?.date}`);
		if (i?.part === "item_overdue") return /** @type {LocalizedString} */ (`${i?.title} (${i?.incident}), overdue since ${i?.date}`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open your follow-ups`);
		if (i?.part === "off") return /** @type {LocalizedString} */ (`To stop these reminders, turn off Follow-up reminders in the Email card on the dashboard, or under Email in the Brigade app's account settings.`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`You get this email because you own follow-ups in ${i?.workspace} on Brigade.`);
		return /** @type {LocalizedString} */ (`Follow-ups due in ${i?.workspace}`)
	}
});