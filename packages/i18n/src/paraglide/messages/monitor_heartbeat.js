/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, interval: NonNullable<unknown> }} Monitor_HeartbeatInputs */



/**
* | part | output |
* | --- | --- |
* | "once" | "Shown only once" |
* | "send" | "Send a POST to this URL at least every {interval}. Brigade keeps only a hash of it, so it can't be shown again." |
* | "try" | "Try it from a terminal:" |
* | "copy" | "Copy URL" |
* | "copied" | "Copied" |
* | "close_prompt" | "Close without copying? The URL can't be shown again." |
* | "close" | "Close anyway" |
* | * | "Keep it open" |
*
* @param {Monitor_HeartbeatInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_heartbeat = /** @type {((inputs: Monitor_HeartbeatInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_HeartbeatInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "once") return /** @type {LocalizedString} */ (`Mostrada só uma vez`);
		if (i?.part === "send") return /** @type {LocalizedString} */ (`Envie um POST para esta URL pelo menos a cada ${i?.interval}. O Brigade guarda só um hash dela, então ela não pode ser mostrada de novo.`);
		if (i?.part === "try") return /** @type {LocalizedString} */ (`Teste no terminal:`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copiar URL`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copiada`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Fechar sem copiar? A URL não pode ser mostrada de novo.`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Fechar mesmo assim`);
		return /** @type {LocalizedString} */ (`Manter aberta`)
	}
	{
		if (i?.part === "once") return /** @type {LocalizedString} */ (`Shown only once`);
		if (i?.part === "send") return /** @type {LocalizedString} */ (`Send a POST to this URL at least every ${i?.interval}. Brigade keeps only a hash of it, so it can't be shown again.`);
		if (i?.part === "try") return /** @type {LocalizedString} */ (`Try it from a terminal:`);
		if (i?.part === "copy") return /** @type {LocalizedString} */ (`Copy URL`);
		if (i?.part === "copied") return /** @type {LocalizedString} */ (`Copied`);
		if (i?.part === "close_prompt") return /** @type {LocalizedString} */ (`Close without copying? The URL can't be shown again.`);
		if (i?.part === "close") return /** @type {LocalizedString} */ (`Close anyway`);
		return /** @type {LocalizedString} */ (`Keep it open`)
	}
});