/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, workspace: NonNullable<unknown> }} Accept_ErrorInputs */



/**
* | reason | output |
* | --- | --- |
* | "workspace_full" | "{workspace} has reached its member limit. Ask an owner to make room." |
* | "workspace_limit" | "You already belong to as many workspaces as Brigade allows. Leave one first." |
* | "already_member" | "You're already a member of {workspace}." |
* | "conflict" | "The invitation changed meanwhile. Reload the page." |
* | "not_applied" | "You joined. Paging catches up on its own within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't reach Brigade. Check your connection and try again." |
* | * | "Something went wrong. Try again." |
*
* @param {Accept_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const accept_error = /** @type {((inputs: Accept_ErrorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Accept_ErrorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.reason === "workspace_full") return /** @type {LocalizedString} */ (`${i?.workspace} atingiu o limite de membros. Peça a um proprietário para abrir espaço.`);
		if (i?.reason === "workspace_limit") return /** @type {LocalizedString} */ (`Você já está no máximo de espaços de trabalho que o Brigade permite. Saia de um antes.`);
		if (i?.reason === "already_member") return /** @type {LocalizedString} */ (`Você já é membro de ${i?.workspace}.`);
		if (i?.reason === "conflict") return /** @type {LocalizedString} */ (`O convite mudou enquanto isso. Recarregue a página.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`Você entrou. Os chamados se ajustam sozinhos em até um minuto.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acessar o banco de dados. Nada mudou; tente de novo.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Não foi possível falar com o Brigade. Verifique sua conexão e tente de novo.`);
		return /** @type {LocalizedString} */ (`Algo deu errado. Tente de novo.`)
	}
	{
		if (i?.reason === "workspace_full") return /** @type {LocalizedString} */ (`${i?.workspace} has reached its member limit. Ask an owner to make room.`);
		if (i?.reason === "workspace_limit") return /** @type {LocalizedString} */ (`You already belong to as many workspaces as Brigade allows. Leave one first.`);
		if (i?.reason === "already_member") return /** @type {LocalizedString} */ (`You're already a member of ${i?.workspace}.`);
		if (i?.reason === "conflict") return /** @type {LocalizedString} */ (`The invitation changed meanwhile. Reload the page.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`You joined. Paging catches up on its own within a minute.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`Brigade couldn't reach its database. Nothing changed; try again.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Couldn't reach Brigade. Check your connection and try again.`);
		return /** @type {LocalizedString} */ (`Something went wrong. Try again.`)
	}
});