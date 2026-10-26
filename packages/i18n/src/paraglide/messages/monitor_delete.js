/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_DeleteInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Delete monitor" |
* | "prompt" | "Delete {name}? Its checks stop and its results are gone for good." |
* | "alert" | "Its firing alert resolves. The incident it opened is left for people to close." |
* | "incidents" | "Incidents it opened before stay as they are." |
* | "heartbeat" | "Its heartbeat URL stops working." |
* | "keep" | "Keep monitor" |
* | * | "Delete" |
*
* @param {Monitor_DeleteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_delete = /** @type {((inputs: Monitor_DeleteInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_DeleteInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Excluir monitor`);
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? As verificações param e os resultados se perdem de vez.`);
		if (i?.part === "alert") return /** @type {LocalizedString} */ (`O alerta ativo é resolvido. O incidente que ele abriu fica para as pessoas encerrarem.`);
		if (i?.part === "incidents") return /** @type {LocalizedString} */ (`Incidentes que ele abriu antes continuam como estão.`);
		if (i?.part === "heartbeat") return /** @type {LocalizedString} */ (`A URL do heartbeat deixa de funcionar.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter monitor`);
		return /** @type {LocalizedString} */ (`Excluir`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Delete monitor`);
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Its checks stop and its results are gone for good.`);
		if (i?.part === "alert") return /** @type {LocalizedString} */ (`Its firing alert resolves. The incident it opened is left for people to close.`);
		if (i?.part === "incidents") return /** @type {LocalizedString} */ (`Incidents it opened before stay as they are.`);
		if (i?.part === "heartbeat") return /** @type {LocalizedString} */ (`Its heartbeat URL stops working.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep monitor`);
		return /** @type {LocalizedString} */ (`Delete`)
	}
});