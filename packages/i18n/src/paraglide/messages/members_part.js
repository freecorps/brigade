/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Members_PartInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Members" |
* | "description" | "Owners and admins change roles and remove members. Someone removed stops being paged right away." |
* | "read_only" | "Only owners and admins change roles or remove members." |
* | "you" | "You" |
* | "unnamed" | "Unnamed member" |
* | "role_label" | "Role" |
* | "remove" | "Remove" |
* | "leave" | "Leave workspace" |
* | "remove_prompt" | "Remove {name} from the workspace? They lose access and stop being paged right away." |
* | "leave_prompt" | "Leave this workspace? You lose access and stop being paged right away." |
* | "cancel" | "Cancel" |
* | "saving" | "Saving…" |
* | "empty" | "Nobody else is in this workspace yet." |
* | "demote" | "Change role" |
* | "retry" | "Try again" |
* | "only_owner" | "You're the only owner. Make someone else an owner before you can leave or change your role." |
* | * | "Members" |
*
* @param {Members_PartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const members_part = /** @type {((inputs: Members_PartInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Members_PartInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Membros`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Proprietários e admins mudam papéis e removem membros. Quem é removido deixa de receber chamados na hora.`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Só proprietários e admins mudam papéis ou removem membros.`);
		if (i?.part === "you") return /** @type {LocalizedString} */ (`Você`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Membro sem nome`);
		if (i?.part === "role_label") return /** @type {LocalizedString} */ (`Papel`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "leave") return /** @type {LocalizedString} */ (`Sair do espaço de trabalho`);
		if (i?.part === "remove_prompt") return /** @type {LocalizedString} */ (`Remover ${i?.name} do espaço de trabalho? A pessoa perde o acesso e deixa de receber chamados na hora.`);
		if (i?.part === "leave_prompt") return /** @type {LocalizedString} */ (`Sair deste espaço de trabalho? Você perde o acesso e deixa de receber chamados na hora.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Ainda não há mais ninguém neste espaço de trabalho.`);
		if (i?.part === "demote") return /** @type {LocalizedString} */ (`Mudar papel`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "only_owner") return /** @type {LocalizedString} */ (`Você é o único proprietário. Torne outra pessoa proprietária antes de sair ou mudar seu papel.`);
		return /** @type {LocalizedString} */ (`Membros`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Members`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Owners and admins change roles and remove members. Someone removed stops being paged right away.`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Only owners and admins change roles or remove members.`);
		if (i?.part === "you") return /** @type {LocalizedString} */ (`You`);
		if (i?.part === "unnamed") return /** @type {LocalizedString} */ (`Unnamed member`);
		if (i?.part === "role_label") return /** @type {LocalizedString} */ (`Role`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.part === "leave") return /** @type {LocalizedString} */ (`Leave workspace`);
		if (i?.part === "remove_prompt") return /** @type {LocalizedString} */ (`Remove ${i?.name} from the workspace? They lose access and stop being paged right away.`);
		if (i?.part === "leave_prompt") return /** @type {LocalizedString} */ (`Leave this workspace? You lose access and stop being paged right away.`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nobody else is in this workspace yet.`);
		if (i?.part === "demote") return /** @type {LocalizedString} */ (`Change role`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "only_owner") return /** @type {LocalizedString} */ (`You're the only owner. Make someone else an owner before you can leave or change your role.`);
		return /** @type {LocalizedString} */ (`Members`)
	}
});