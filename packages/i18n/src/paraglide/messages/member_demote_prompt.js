/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, role: NonNullable<unknown> }} Member_Demote_PromptInputs */



/**
* | kind | output |
* | --- | --- |
* | "owner" | "Change your role to {role}? You can no longer manage owners; only an owner can give it back." |
* | * | "Change your role to {role}? You can no longer manage members; only an owner or admin can give it back." |
*
* @param {Member_Demote_PromptInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const member_demote_prompt = /** @type {((inputs: Member_Demote_PromptInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Demote_PromptInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "owner") return /** @type {LocalizedString} */ (`Mudar seu papel para ${i?.role}? Você deixa de gerenciar proprietários; só um proprietário pode devolvê-lo.`);
		return /** @type {LocalizedString} */ (`Mudar seu papel para ${i?.role}? Você deixa de gerenciar membros; só um proprietário ou admin pode devolvê-lo.`)
	}
	{
		if (i?.kind === "owner") return /** @type {LocalizedString} */ (`Change your role to ${i?.role}? You can no longer manage owners; only an owner can give it back.`);
		return /** @type {LocalizedString} */ (`Change your role to ${i?.role}? You can no longer manage members; only an owner or admin can give it back.`)
	}
});