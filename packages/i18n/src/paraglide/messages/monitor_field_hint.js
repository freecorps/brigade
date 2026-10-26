/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_HintInputs */



/**
* | field | output |
* | --- | --- |
* | "url" | "Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it." |
* | "expected_status" | "Empty: any 2xx or 3xx. Redirects are not followed." |
* | "host" | "The check passes when a connection to this host and port opens. Nothing is sent." |
* | "timeout" | "How long one check may take." |
* | "timeout_tcp" | "How long the connection may take to open." |
* | * | "How late a ping may be before it counts as missed." |
*
* @param {Monitor_Field_HintInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_field_hint = /** @type {((inputs: Monitor_Field_HintInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_HintInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Todos no workspace, inclusive leitores, veem esta URL: não coloque tokens nem senhas nela.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Vazio: qualquer 2xx ou 3xx. Redirecionamentos não são seguidos.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`A verificação passa quando uma conexão com este host e porta abre. Nada é enviado.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Quanto tempo uma verificação pode levar.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`Quanto tempo a conexão pode levar para abrir.`);
		return /** @type {LocalizedString} */ (`Quanto um sinal pode atrasar antes de contar como perdido.`)
	}
	{
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Empty: any 2xx or 3xx. Redirects are not followed.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`The check passes when a connection to this host and port opens. Nothing is sent.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`How long one check may take.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`How long the connection may take to open.`);
		return /** @type {LocalizedString} */ (`How late a ping may be before it counts as missed.`)
	}
});