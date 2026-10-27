/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_HintInputs */



/**
* | field | output |
* | --- | --- |
* | "url" | "Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it." |
* | "expected_status" | "Empty: any 2xx or 3xx. Redirects are not followed." |
* | "host" | "Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP." |
* | "port" | "Any port but 25." |
* | "timeout" | "How long one check may take." |
* | "timeout_tcp" | "How long the connection may take to open." |
* | "policy" | "An incident this monitor opens pages through this policy." |
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
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Passa quando uma conexão com este host e porta abre; nada é enviado. Hosts com proxy da Cloudflare não podem ser verificados por TCP.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Qualquer porta menos a 25.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Quanto tempo uma verificação pode levar.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`Quanto tempo a conexão pode levar para abrir.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`Um incidente aberto por este monitor chama por esta política.`);
		return /** @type {LocalizedString} */ (`Quanto um sinal pode atrasar antes de contar como perdido.`)
	}
	{
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Empty: any 2xx or 3xx. Redirects are not followed.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Any port but 25.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`How long one check may take.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`How long the connection may take to open.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`An incident this monitor opens pages through this policy.`);
		return /** @type {LocalizedString} */ (`How late a ping may be before it counts as missed.`)
	}
});