/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_InvalidInputs */



/**
* | field | output |
* | --- | --- |
* | "name" | "Give the monitor a name." |
* | "url" | "Use a public http or https address, on a web port such as 80, 443, 8080 or 8443." |
* | "host" | "Use a public host name or IP address, without http:// or a port." |
* | "host_cloudflare" | "Cloudflare doesn't allow TCP checks of its own addresses. Use your server's address." |
* | "host_underscore" | "Host names can't contain underscores (_). Use a public host name or IP address." |
* | "port" | "Use a port from 1 to 65535." |
* | "port_blocked" | "Cloudflare blocks port 25. Use another port." |
* | "expected_status" | "Use statuses from 100 to 599, like 200, 204 or 301-302, or leave it empty." |
* | "keyword" | "Use at most 200 characters." |
* | "interval" | "Use whole seconds, from 30 to 86,400 (24 hours)." |
* | "timeout" | "Use 1 to 30 seconds, and no more than the interval." |
* | "grace" | "Use whole seconds, from 0 to 86,400 (24 hours)." |
* | "regions" | "Pick at least one region." |
* | "policy" | "That policy no longer exists. Pick another." |
* | "keyword_regex" | "This pattern isn't supported. Lookarounds, backreferences and word boundaries aren't, and repeat counts go up to 100." |
* | "headers" | "Fix the marked headers: each needs a name and a value of plain characters, no credentials, and no name twice." |
* | "quorum" | "Pick at most as many regions as it checks from." |
* | "consecutive" | "Use a whole number from 1 to 10, or leave it empty." |
* | * | "Check this value." |
*
* @param {Monitor_Field_InvalidInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_field_invalid = /** @type {((inputs: Monitor_Field_InvalidInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_InvalidInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Dê um nome ao monitor.`);
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Use um endereço http ou https público, numa porta web como 80, 443, 8080 ou 8443.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Use um nome de host ou endereço IP público, sem http:// nem porta.`);
		if (i?.field === "host_cloudflare") return /** @type {LocalizedString} */ (`A Cloudflare não permite verificações TCP dos próprios endereços. Use o endereço do seu servidor.`);
		if (i?.field === "host_underscore") return /** @type {LocalizedString} */ (`Nomes de host não podem ter sublinhado (_). Use um nome de host ou endereço IP público.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Use uma porta de 1 a 65535.`);
		if (i?.field === "port_blocked") return /** @type {LocalizedString} */ (`A Cloudflare bloqueia a porta 25. Use outra porta.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Use status de 100 a 599, como 200, 204 ou 301-302, ou deixe vazio.`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Use no máximo 200 caracteres.`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`Use segundos inteiros, de 30 a 86.400 (24 horas).`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Use de 1 a 30 segundos, e não mais que o intervalo.`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Use segundos inteiros, de 0 a 86.400 (24 horas).`);
		if (i?.field === "regions") return /** @type {LocalizedString} */ (`Escolha pelo menos uma região.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`Essa política não existe mais. Escolha outra.`);
		if (i?.field === "keyword_regex") return /** @type {LocalizedString} */ (`Este padrão não é aceito. Lookarounds, referências anteriores e limites de palavra não são, e repetições vão até 100.`);
		if (i?.field === "headers") return /** @type {LocalizedString} */ (`Corrija os cabeçalhos marcados: cada um precisa de nome e valor com caracteres simples, sem credenciais e sem nome repetido.`);
		if (i?.field === "quorum") return /** @type {LocalizedString} */ (`Escolha no máximo o número de regiões de onde ele verifica.`);
		if (i?.field === "consecutive") return /** @type {LocalizedString} */ (`Use um número inteiro de 1 a 10, ou deixe vazio.`);
		return /** @type {LocalizedString} */ (`Confira este valor.`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Give the monitor a name.`);
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Use a public http or https address, on a web port such as 80, 443, 8080 or 8443.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Use a public host name or IP address, without http:// or a port.`);
		if (i?.field === "host_cloudflare") return /** @type {LocalizedString} */ (`Cloudflare doesn't allow TCP checks of its own addresses. Use your server's address.`);
		if (i?.field === "host_underscore") return /** @type {LocalizedString} */ (`Host names can't contain underscores (_). Use a public host name or IP address.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Use a port from 1 to 65535.`);
		if (i?.field === "port_blocked") return /** @type {LocalizedString} */ (`Cloudflare blocks port 25. Use another port.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Use statuses from 100 to 599, like 200, 204 or 301-302, or leave it empty.`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Use at most 200 characters.`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`Use whole seconds, from 30 to 86,400 (24 hours).`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Use 1 to 30 seconds, and no more than the interval.`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Use whole seconds, from 0 to 86,400 (24 hours).`);
		if (i?.field === "regions") return /** @type {LocalizedString} */ (`Pick at least one region.`);
		if (i?.field === "policy") return /** @type {LocalizedString} */ (`That policy no longer exists. Pick another.`);
		if (i?.field === "keyword_regex") return /** @type {LocalizedString} */ (`This pattern isn't supported. Lookarounds, backreferences and word boundaries aren't, and repeat counts go up to 100.`);
		if (i?.field === "headers") return /** @type {LocalizedString} */ (`Fix the marked headers: each needs a name and a value of plain characters, no credentials, and no name twice.`);
		if (i?.field === "quorum") return /** @type {LocalizedString} */ (`Pick at most as many regions as it checks from.`);
		if (i?.field === "consecutive") return /** @type {LocalizedString} */ (`Use a whole number from 1 to 10, or leave it empty.`);
		return /** @type {LocalizedString} */ (`Check this value.`)
	}
});