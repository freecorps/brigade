/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, email: NonNullable<unknown>, date: NonNullable<unknown>, name: NonNullable<unknown> }} Invite_PartInputs */



/**
* | part | output |
* | --- | --- |
* | "open" | "Invite" |
* | "title" | "Invite someone" |
* | "hint" | "They get an email with a link that works for 7 days. Only that address can accept it." |
* | "email_label" | "Email" |
* | "role_label" | "Role" |
* | "submit" | "Send invitation" |
* | "sending" | "Sending…" |
* | "cancel" | "Cancel" |
* | "sent" | "Invitation sent to {email}." |
* | "unverified" | "Confirm your own email before you invite people." |
* | "pending_title" | "Pending invitations" |
* | "expires" | "Expires {date}" |
* | "expired" | "Expired: resend it to give it 7 more days" |
* | "invited_by" | "Invited by {name}" |
* | "resend" | "Resend" |
* | "resent" | "Sent again to {email}." |
* | "revoke" | "Revoke" |
* | "revoke_prompt" | "Revoke the invitation to {email}? Its link stops working." |
* | "revoked" | "Invitation to {email} revoked." |
* | "load_failed" | "Couldn't load the pending invitations." |
* | * | "Invite" |
*
* @param {Invite_PartInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const invite_part = /** @type {((inputs: Invite_PartInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Invite_PartInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Convidar`);
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Convidar alguém`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`A pessoa recebe um email com um link que vale por 7 dias. Só esse endereço pode aceitá-lo.`);
		if (i?.part === "email_label") return /** @type {LocalizedString} */ (`Email`);
		if (i?.part === "role_label") return /** @type {LocalizedString} */ (`Papel`);
		if (i?.part === "submit") return /** @type {LocalizedString} */ (`Enviar convite`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Enviando…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "sent") return /** @type {LocalizedString} */ (`Convite enviado para ${i?.email}.`);
		if (i?.part === "unverified") return /** @type {LocalizedString} */ (`Confirme seu próprio email antes de convidar pessoas.`);
		if (i?.part === "pending_title") return /** @type {LocalizedString} */ (`Convites pendentes`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expira ${i?.date}`);
		if (i?.part === "expired") return /** @type {LocalizedString} */ (`Expirado: reenvie para mais 7 dias`);
		if (i?.part === "invited_by") return /** @type {LocalizedString} */ (`Convidado por ${i?.name}`);
		if (i?.part === "resend") return /** @type {LocalizedString} */ (`Reenviar`);
		if (i?.part === "resent") return /** @type {LocalizedString} */ (`Enviado de novo para ${i?.email}.`);
		if (i?.part === "revoke") return /** @type {LocalizedString} */ (`Revogar`);
		if (i?.part === "revoke_prompt") return /** @type {LocalizedString} */ (`Revogar o convite para ${i?.email}? O link deixa de funcionar.`);
		if (i?.part === "revoked") return /** @type {LocalizedString} */ (`Convite para ${i?.email} revogado.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar os convites pendentes.`);
		return /** @type {LocalizedString} */ (`Convidar`)
	}
	{
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Invite`);
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Invite someone`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`They get an email with a link that works for 7 days. Only that address can accept it.`);
		if (i?.part === "email_label") return /** @type {LocalizedString} */ (`Email`);
		if (i?.part === "role_label") return /** @type {LocalizedString} */ (`Role`);
		if (i?.part === "submit") return /** @type {LocalizedString} */ (`Send invitation`);
		if (i?.part === "sending") return /** @type {LocalizedString} */ (`Sending…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "sent") return /** @type {LocalizedString} */ (`Invitation sent to ${i?.email}.`);
		if (i?.part === "unverified") return /** @type {LocalizedString} */ (`Confirm your own email before you invite people.`);
		if (i?.part === "pending_title") return /** @type {LocalizedString} */ (`Pending invitations`);
		if (i?.part === "expires") return /** @type {LocalizedString} */ (`Expires ${i?.date}`);
		if (i?.part === "expired") return /** @type {LocalizedString} */ (`Expired: resend it to give it 7 more days`);
		if (i?.part === "invited_by") return /** @type {LocalizedString} */ (`Invited by ${i?.name}`);
		if (i?.part === "resend") return /** @type {LocalizedString} */ (`Resend`);
		if (i?.part === "resent") return /** @type {LocalizedString} */ (`Sent again to ${i?.email}.`);
		if (i?.part === "revoke") return /** @type {LocalizedString} */ (`Revoke`);
		if (i?.part === "revoke_prompt") return /** @type {LocalizedString} */ (`Revoke the invitation to ${i?.email}? Its link stops working.`);
		if (i?.part === "revoked") return /** @type {LocalizedString} */ (`Invitation to ${i?.email} revoked.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the pending invitations.`);
		return /** @type {LocalizedString} */ (`Invite`)
	}
});