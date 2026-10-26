/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown> }} Monitor_Kind_ShortInputs */



/**
* | kind | output |
* | --- | --- |
* | "http" | "HTTP" |
* | "tcp" | "TCP" |
* | * | "Heartbeat" |
*
* @param {Monitor_Kind_ShortInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_kind_short = /** @type {((inputs: Monitor_Kind_ShortInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Kind_ShortInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`HTTP`);
		if (i?.kind === "tcp") return /** @type {LocalizedString} */ (`TCP`);
		return /** @type {LocalizedString} */ (`Heartbeat`)
	}
	{
		if (i?.kind === "http") return /** @type {LocalizedString} */ (`HTTP`);
		if (i?.kind === "tcp") return /** @type {LocalizedString} */ (`TCP`);
		return /** @type {LocalizedString} */ (`Heartbeat`)
	}
});