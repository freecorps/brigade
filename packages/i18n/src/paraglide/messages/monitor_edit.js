/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_EditInputs */



/**
* | part | output |
* | --- | --- |
* | "action" | "Edit" |
* | "form" | "Edit {name}" |
* | "restart" | "Saving starts its checks over: the last results are dropped and it shows Waiting until its regions report again." |
* | "restart_alert" | "Its firing alert stays until its checks pass again." |
* | * | "Save changes" |
*
* @param {Monitor_EditInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_edit = /** @type {((inputs: Monitor_EditInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_EditInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "form") return /** @type {LocalizedString} */ (`Editar ${i?.name}`);
		if (i?.part === "restart") return /** @type {LocalizedString} */ (`Salvar recomeça as verificações: os últimos resultados são descartados e ele mostra Aguardando até as regiões responderem de novo.`);
		if (i?.part === "restart_alert") return /** @type {LocalizedString} */ (`O alerta ativo continua até as verificações voltarem a passar.`);
		return /** @type {LocalizedString} */ (`Salvar alterações`)
	}
	{
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "form") return /** @type {LocalizedString} */ (`Edit ${i?.name}`);
		if (i?.part === "restart") return /** @type {LocalizedString} */ (`Saving starts its checks over: the last results are dropped and it shows Waiting until its regions report again.`);
		if (i?.part === "restart_alert") return /** @type {LocalizedString} */ (`Its firing alert stays until its checks pass again.`);
		return /** @type {LocalizedString} */ (`Save changes`)
	}
});