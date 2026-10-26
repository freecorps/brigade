/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ role: NonNullable<unknown> }} Member_RoleInputs */



/**
* | role | output |
* | --- | --- |
* | "owner" | "Owner" |
* | "admin" | "Admin" |
* | "responder" | "Responder" |
* | "viewer" | "Viewer" |
* | * | "Member" |
*
* @param {Member_RoleInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const member_role = /** @type {((inputs: Member_RoleInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Member_RoleInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.role === "owner") return /** @type {LocalizedString} */ (`Proprietário`);
		if (i?.role === "admin") return /** @type {LocalizedString} */ (`Admin`);
		if (i?.role === "responder") return /** @type {LocalizedString} */ (`Respondedor`);
		if (i?.role === "viewer") return /** @type {LocalizedString} */ (`Leitor`);
		return /** @type {LocalizedString} */ (`Membro`)
	}
	{
		if (i?.role === "owner") return /** @type {LocalizedString} */ (`Owner`);
		if (i?.role === "admin") return /** @type {LocalizedString} */ (`Admin`);
		if (i?.role === "responder") return /** @type {LocalizedString} */ (`Responder`);
		if (i?.role === "viewer") return /** @type {LocalizedString} */ (`Viewer`);
		return /** @type {LocalizedString} */ (`Member`)
	}
});