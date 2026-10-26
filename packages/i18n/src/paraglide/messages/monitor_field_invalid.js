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
* | "port" | "Use a port from 1 to 65535. Port 25 is blocked by Cloudflare." |
* | "expected_status" | "Use a status from 100 to 599, or leave it empty." |
* | "keyword" | "Use at most 200 characters." |
* | "interval" | "Use whole seconds, from 30 to 86,400 (24 hours)." |
* | "timeout" | "Use 1 to 30 seconds, and no more than the interval." |
* | "grace" | "Use whole seconds, from 0 to 86,400 (24 hours)." |
* | "regions" | "Pick at least one region." |
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
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Use uma porta de 1 a 65535. A porta 25 é bloqueada pela Cloudflare.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Use um status de 100 a 599, ou deixe vazio.`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Use no máximo 200 caracteres.`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`Use segundos inteiros, de 30 a 86.400 (24 horas).`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Use de 1 a 30 segundos, e não mais que o intervalo.`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Use segundos inteiros, de 0 a 86.400 (24 horas).`);
		if (i?.field === "regions") return /** @type {LocalizedString} */ (`Escolha pelo menos uma região.`);
		return /** @type {LocalizedString} */ (`Confira este valor.`)
	}
	{
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Give the monitor a name.`);
		if (i?.field === "url") return /** @type {LocalizedString} */ (`Use a public http or https address, on a web port such as 80, 443, 8080 or 8443.`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Use a public host name or IP address, without http:// or a port.`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Use a port from 1 to 65535. Port 25 is blocked by Cloudflare.`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Use a status from 100 to 599, or leave it empty.`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Use at most 200 characters.`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`Use whole seconds, from 30 to 86,400 (24 hours).`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Use 1 to 30 seconds, and no more than the interval.`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Use whole seconds, from 0 to 86,400 (24 hours).`);
		if (i?.field === "regions") return /** @type {LocalizedString} */ (`Pick at least one region.`);
		return /** @type {LocalizedString} */ (`Check this value.`)
	}
});