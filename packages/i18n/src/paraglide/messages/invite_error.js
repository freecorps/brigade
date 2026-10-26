/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, email: NonNullable<unknown> }} Invite_ErrorInputs */



/**
* | reason | output |
* | --- | --- |
* | "forbidden" | "You can't make this change." |
* | "already_member" | "{email} is already a member." |
* | "already_invited" | "{email} already has a pending invitation. Resend it from the list." |
* | "limit_reached" | "This workspace has too many pending invitations. Revoke some first." |
* | "rate_limited" | "This workspace sent too many invitations today. Try again tomorrow." |
* | "address_limited" | "{email} got several invitations today. Try again tomorrow." |
* | "inviter_limited" | "You sent too many invitations today. Try again tomorrow." |
* | "send_limit" | "Brigade won't send this invitation again. Revoke it, then invite {email} again if they still need it." |
* | "too_soon" | "This invitation went out a few minutes ago. Wait a little before sending it again." |
* | "not_found" | "This invitation is no longer pending." |
* | "unverified" | "Confirm your own email before you invite people." |
* | "invalid_email" | "Enter an email address like name@example.com." |
* | "not_applied" | "Saved. The email goes out within a minute." |
* | "unavailable" | "Brigade couldn't reach its database. Nothing changed; try again." |
* | "network" | "Couldn't confirm the change; check the list." |
* | * | "Something went wrong. Try again." |
*
* @param {Invite_ErrorInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const invite_error = /** @type {((inputs: Invite_ErrorInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Invite_ErrorInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.reason === "forbidden") return /** @type {LocalizedString} */ (`Você não pode fazer esta alteração.`);
		if (i?.reason === "already_member") return /** @type {LocalizedString} */ (`${i?.email} já é membro.`);
		if (i?.reason === "already_invited") return /** @type {LocalizedString} */ (`${i?.email} já tem um convite pendente. Reenvie-o pela lista.`);
		if (i?.reason === "limit_reached") return /** @type {LocalizedString} */ (`Este espaço de trabalho tem convites pendentes demais. Revogue alguns antes.`);
		if (i?.reason === "rate_limited") return /** @type {LocalizedString} */ (`Este espaço de trabalho enviou convites demais hoje. Tente de novo amanhã.`);
		if (i?.reason === "address_limited") return /** @type {LocalizedString} */ (`${i?.email} recebeu vários convites hoje. Tente de novo amanhã.`);
		if (i?.reason === "inviter_limited") return /** @type {LocalizedString} */ (`Você enviou convites demais hoje. Tente de novo amanhã.`);
		if (i?.reason === "send_limit") return /** @type {LocalizedString} */ (`O Brigade não vai enviar este convite de novo. Revogue-o e convide ${i?.email} de novo, se a pessoa ainda precisar.`);
		if (i?.reason === "too_soon") return /** @type {LocalizedString} */ (`Este convite saiu há poucos minutos. Espere um pouco antes de reenviá-lo.`);
		if (i?.reason === "not_found") return /** @type {LocalizedString} */ (`Este convite não está mais pendente.`);
		if (i?.reason === "unverified") return /** @type {LocalizedString} */ (`Confirme seu próprio email antes de convidar pessoas.`);
		if (i?.reason === "invalid_email") return /** @type {LocalizedString} */ (`Digite um endereço de email como nome@example.com.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`Salvo. O email sai em até um minuto.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acessar o banco de dados. Nada mudou; tente de novo.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Não foi possível confirmar a alteração; confira a lista.`);
		return /** @type {LocalizedString} */ (`Algo deu errado. Tente de novo.`)
	}
	{
		if (i?.reason === "forbidden") return /** @type {LocalizedString} */ (`You can't make this change.`);
		if (i?.reason === "already_member") return /** @type {LocalizedString} */ (`${i?.email} is already a member.`);
		if (i?.reason === "already_invited") return /** @type {LocalizedString} */ (`${i?.email} already has a pending invitation. Resend it from the list.`);
		if (i?.reason === "limit_reached") return /** @type {LocalizedString} */ (`This workspace has too many pending invitations. Revoke some first.`);
		if (i?.reason === "rate_limited") return /** @type {LocalizedString} */ (`This workspace sent too many invitations today. Try again tomorrow.`);
		if (i?.reason === "address_limited") return /** @type {LocalizedString} */ (`${i?.email} got several invitations today. Try again tomorrow.`);
		if (i?.reason === "inviter_limited") return /** @type {LocalizedString} */ (`You sent too many invitations today. Try again tomorrow.`);
		if (i?.reason === "send_limit") return /** @type {LocalizedString} */ (`Brigade won't send this invitation again. Revoke it, then invite ${i?.email} again if they still need it.`);
		if (i?.reason === "too_soon") return /** @type {LocalizedString} */ (`This invitation went out a few minutes ago. Wait a little before sending it again.`);
		if (i?.reason === "not_found") return /** @type {LocalizedString} */ (`This invitation is no longer pending.`);
		if (i?.reason === "unverified") return /** @type {LocalizedString} */ (`Confirm your own email before you invite people.`);
		if (i?.reason === "invalid_email") return /** @type {LocalizedString} */ (`Enter an email address like name@example.com.`);
		if (i?.reason === "not_applied") return /** @type {LocalizedString} */ (`Saved. The email goes out within a minute.`);
		if (i?.reason === "unavailable") return /** @type {LocalizedString} */ (`Brigade couldn't reach its database. Nothing changed; try again.`);
		if (i?.reason === "network") return /** @type {LocalizedString} */ (`Couldn't confirm the change; check the list.`);
		return /** @type {LocalizedString} */ (`Something went wrong. Try again.`)
	}
});