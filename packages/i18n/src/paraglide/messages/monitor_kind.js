/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown> }} Monitor_KindInputs */



/**
* | kind | output |
* | --- | --- |
* | "http" | "HTTP check" |
* | "tcp" | "TCP port" |
* | * | "Heartbeat" |
*
* @param {Monitor_KindInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_kind = /** @type {((inputs: Monitor_KindInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_KindInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`Verificação HTTP`);
		if (i?.kind === "tcp") return /** @type {LocalizedString} */ (`Porta TCP`);
		return /** @type {LocalizedString} */ (`Heartbeat`)
	}
	{
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`HTTP check`);
		if (i?.kind === "tcp") return /** @type {LocalizedString} */ (`TCP port`);
		return /** @type {LocalizedString} */ (`Heartbeat`)
	}
});