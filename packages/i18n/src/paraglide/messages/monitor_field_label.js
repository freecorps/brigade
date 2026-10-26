/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Monitor_Field_LabelInputs */



/**
* | field | output |
* | --- | --- |
* | "kind" | "Monitor type" |
* | "name" | "Name" |
* | "url" | "URL" |
* | "host" | "Host" |
* | "port" | "Port" |
* | "method" | "Method" |
* | "expected_status" | "Expected status" |
* | "keyword" | "Text the page must contain" |
* | "interval" | "Every (seconds)" |
* | "timeout" | "Timeout (seconds)" |
* | "grace" | "Grace (seconds)" |
* | * | "Check from" |
*
* @param {Monitor_Field_LabelInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_field_label = /** @type {((inputs: Monitor_Field_LabelInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Field_LabelInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.field === "kind") return /** @type {LocalizedString} */ (`Tipo de monitor`);
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.field === "url") return /** @type {LocalizedString} */ (`URL`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Host`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Porta`);
		if (i?.field === "method") return /** @type {LocalizedString} */ (`Método`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Status esperado`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Texto que a página deve conter`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`A cada (segundos)`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Tempo limite (segundos)`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Tolerância (segundos)`);
		return /** @type {LocalizedString} */ (`Verificar de`)
	}
	{
		if (i?.field === "kind") return /** @type {LocalizedString} */ (`Monitor type`);
		if (i?.field === "name") return /** @type {LocalizedString} */ (`Name`);
		if (i?.field === "url") return /** @type {LocalizedString} */ (`URL`);
		if (i?.field === "host") return /** @type {LocalizedString} */ (`Host`);
		if (i?.field === "port") return /** @type {LocalizedString} */ (`Port`);
		if (i?.field === "method") return /** @type {LocalizedString} */ (`Method`);
		if (i?.field === "expected_status") return /** @type {LocalizedString} */ (`Expected status`);
		if (i?.field === "keyword") return /** @type {LocalizedString} */ (`Text the page must contain`);
		if (i?.field === "interval") return /** @type {LocalizedString} */ (`Every (seconds)`);
		if (i?.field === "timeout") return /** @type {LocalizedString} */ (`Timeout (seconds)`);
		if (i?.field === "grace") return /** @type {LocalizedString} */ (`Grace (seconds)`);
		return /** @type {LocalizedString} */ (`Check from`)
	}
});