/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown> }} Oncall_MineInputs */



/**
* | part | output |
* | --- | --- |
* | "on_call" | "You're on call" |
* | "off_call" | "You're not on call" |
* | "status_until" | "On call until {time}" |
* | "status_next" | "Not on call · next shift {time}" |
* | "status_none" | "Not on call in the next 4 weeks" |
* | "open_hint" | "Opens your shifts and who is on call" |
* | "you_name" | "{name} (you)" |
* | "next" | "Your next shifts" |
* | "next_none" | "No shifts in the next 4 weeks" |
* | "overrides" | "Your overrides" |
* | "remove_mine" | "Remove your override on {name}?" |
* | * | "Schedules and rotations are edited on the dashboard." |
*
* @param {Oncall_MineInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const oncall_mine = /** @type {((inputs: Oncall_MineInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Oncall_MineInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "on_call") return /** @type {LocalizedString} */ (`Você está de plantão`);
		if (i?.part === "off_call") return /** @type {LocalizedString} */ (`Você não está de plantão`);
		if (i?.part === "status_until") return /** @type {LocalizedString} */ (`De plantão até ${i?.time}`);
		if (i?.part === "status_next") return /** @type {LocalizedString} */ (`Fora do plantão · próximo turno ${i?.time}`);
		if (i?.part === "status_none") return /** @type {LocalizedString} */ (`Sem plantão nas próximas 4 semanas`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Abre seus turnos e quem está de plantão`);
		if (i?.part === "you_name") return /** @type {LocalizedString} */ (`${i?.name} (você)`);
		if (i?.part === "next") return /** @type {LocalizedString} */ (`Seus próximos turnos`);
		if (i?.part === "next_none") return /** @type {LocalizedString} */ (`Nenhum turno nas próximas 4 semanas`);
		if (i?.part === "overrides") return /** @type {LocalizedString} */ (`Suas substituições`);
		if (i?.part === "remove_mine") return /** @type {LocalizedString} */ (`Remover sua substituição em ${i?.name}?`);
		return /** @type {LocalizedString} */ (`Escalas e rodízios são editados no painel.`)
	}
	{
		if (i?.part === "on_call") return /** @type {LocalizedString} */ (`You're on call`);
		if (i?.part === "off_call") return /** @type {LocalizedString} */ (`You're not on call`);
		if (i?.part === "status_until") return /** @type {LocalizedString} */ (`On call until ${i?.time}`);
		if (i?.part === "status_next") return /** @type {LocalizedString} */ (`Not on call · next shift ${i?.time}`);
		if (i?.part === "status_none") return /** @type {LocalizedString} */ (`Not on call in the next 4 weeks`);
		if (i?.part === "open_hint") return /** @type {LocalizedString} */ (`Opens your shifts and who is on call`);
		if (i?.part === "you_name") return /** @type {LocalizedString} */ (`${i?.name} (you)`);
		if (i?.part === "next") return /** @type {LocalizedString} */ (`Your next shifts`);
		if (i?.part === "next_none") return /** @type {LocalizedString} */ (`No shifts in the next 4 weeks`);
		if (i?.part === "overrides") return /** @type {LocalizedString} */ (`Your overrides`);
		if (i?.part === "remove_mine") return /** @type {LocalizedString} */ (`Remove your override on ${i?.name}?`);
		return /** @type {LocalizedString} */ (`Schedules and rotations are edited on the dashboard.`)
	}
});