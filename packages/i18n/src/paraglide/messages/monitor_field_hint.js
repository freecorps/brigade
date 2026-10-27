/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_HintInputs */



/**
* | field | output |
* | --- | --- |
* | "url" | "Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it." |
* | "expected_status" | "Empty: any 2xx or 3xx. Or list them: 200, 204, 500-599. Redirects are not followed." |
* | "host" | "Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP." |
* | "port" | "Any port but 25." |
* | "timeout" | "How long one check may take." |
* | "timeout_tcp" | "How long the connection may take to open." |
* | "policy" | "An incident this monitor opens pages through this policy." |
* | "keyword_regex" | "A regular expression, without lookarounds or backreferences. Start it with (?i) to ignore case." |
* | "headers" | "Sent with every check. Everyone in the workspace, viewers too, can see them: Host, Authorization, Cookie and other credentials can't go here." |
* | "severity" | "The severity of the incident it opens." |
* | "quorum" | "How many of its regions must see it down to open an incident, and up to resolve it." |
* | "consecutive" | "Checks a region must fail in a row before it counts as down, and pass to count as up. Empty: 2." |
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
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Vazio: qualquer 2xx ou 3xx. Ou liste: 200, 204, 500-599. Redirecionamentos não são seguidos.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Passa quando uma conexão com este host e porta abre; nada é enviado. Hosts com proxy da Cloudflare não podem ser verificados por TCP.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Qualquer porta menos a 25.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Quanto tempo uma verificação pode levar.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`Quanto tempo a conexão pode levar para abrir.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`Um incidente aberto por este monitor chama por esta política.`);
		if (i?.field === "keyword_regex") return /** @type {LocalizedString} */ (`Uma expressão regular, sem lookarounds nem referências anteriores. Comece com (?i) para ignorar maiúsculas e minúsculas.`);
		if (i?.field === "headers") return /** @type {LocalizedString} */ (`Enviados em toda verificação. Todos no workspace, inclusive leitores, veem os cabeçalhos: Host, Authorization, Cookie e outras credenciais não podem ir aqui.`);
		if (i?.field === "severity") return /** @type {LocalizedString} */ (`A severidade do incidente que ele abre.`);
		if (i?.field === "quorum") return /** @type {LocalizedString} */ (`Quantas das regiões precisam vê-lo fora do ar para abrir um incidente, e no ar para resolvê-lo.`);
		if (i?.field === "consecutive") return /** @type {LocalizedString} */ (`Quantas verificações seguidas uma região precisa falhar para contar como fora do ar, e passar para contar como no ar. Vazio: 2.`);
		return /** @type {LocalizedString} */ (`Quanto um sinal pode atrasar antes de contar como perdido.`)
	}
	{
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Everyone in the workspace, viewers too, can see this URL: keep tokens and passwords out of it.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Empty: any 2xx or 3xx. Or list them: 200, 204, 500-599. Redirects are not followed.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Passes when a connection to this host and port opens; nothing is sent. Hosts proxied by Cloudflare can't be checked over TCP.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Any port but 25.`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`How long one check may take.`);
		if (i?.field === "timeout_tcp") return /** @type {LocalizedString} */ (`How long the connection may take to open.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`An incident this monitor opens pages through this policy.`);
		if (i?.field === "keyword_regex") return /** @type {LocalizedString} */ (`A regular expression, without lookarounds or backreferences. Start it with (?i) to ignore case.`);
		if (i?.field === "headers") return /** @type {LocalizedString} */ (`Sent with every check. Everyone in the workspace, viewers too, can see them: Host, Authorization, Cookie and other credentials can't go here.`);
		if (i?.field === "severity") return /** @type {LocalizedString} */ (`The severity of the incident it opens.`);
		if (i?.field === "quorum") return /** @type {LocalizedString} */ (`How many of its regions must see it down to open an incident, and up to resolve it.`);
		if (i?.field === "consecutive") return /** @type {LocalizedString} */ (`Checks a region must fail in a row before it counts as down, and pass to count as up. Empty: 2.`);
		return /** @type {LocalizedString} */ (`How late a ping may be before it counts as missed.`)
	}
});