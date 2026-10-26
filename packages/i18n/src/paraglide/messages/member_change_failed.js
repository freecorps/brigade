/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown> }} Member_Change_FailedInputs */



/**
* | reason | output |
* | --- | --- |
* | "forbidden" | "You can't make this change." |
* | "last_owner" | "A workspace needs at least one owner. Make someone else an owner first." |
* | "not_found" | "This person is no longer a member." |
* | "conflict" | "Someone else changed this member meanwhile. Check the list and try again." |
* | "not_applied" | "Saved. Paging catches up on its own within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't confirm the change; check the list." |
* | * | "Something went wrong. Try again." |
*
* @param {Member_Change_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const member_change_failed = /** @type {((inputs: Member_Change_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_Change_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.reason === "forbidden") return /** @type {LocalizedString} */ (`Você não pode fazer essa mudança.`);
		if (i?.reason === "last_owner") return /** @type {LocalizedString} */ (`Um espaço de trabalho precisa de pelo menos um proprietário. Torne outra pessoa proprietária primeiro.`);
		if (i?.reason === "not_found") return /** @type {LocalizedString} */ (`Essa pessoa não é mais membro.`);
		if (i?.reason === "conflict") return /** @type {LocalizedString} */ (`Outra pessoa mudou este membro enquanto isso. Confira a lista e tente de novo.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`Salvo. Os chamados se atualizam sozinhos em até um minuto.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acessar o banco de dados. Nada mudou; tente de novo.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Não foi possível confirmar a mudança; confira a lista.`);
		return /** @type {LocalizedString} */ (`Algo deu errado. Tente de novo.`)
	}
	{
		if (i?.reason === "forbidden") return /** @type {LocalizedString} */ (`You can't make this change.`);
		if (i?.reason === "last_owner") return /** @type {LocalizedString} */ (`A workspace needs at least one owner. Make someone else an owner first.`);
		if (i?.reason === "not_found") return /** @type {LocalizedString} */ (`This person is no longer a member.`);
		if (i?.reason === "conflict") return /** @type {LocalizedString} */ (`Someone else changed this member meanwhile. Check the list and try again.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`Saved. Paging catches up on its own within a minute.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`Brigade couldn't reach its database. Nothing changed; try again.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Couldn't confirm the change; check the list.`);
		return /** @type {LocalizedString} */ (`Something went wrong. Try again.`)
	}
});