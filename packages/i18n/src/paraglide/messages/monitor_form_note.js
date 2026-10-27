/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, time: NonNullable<unknown> }} Monitor_Form_NoteInputs */



/**
* | kind | output |
* | --- | --- |
* | "status_5xx" | "A 5xx status means the server failed. Listed here, it counts as up, so this monitor won't page for it." |
* | "quorum_all" | "Every region must see it down: an outage only some regions see won't open an incident. A region that stops reporting is left out until it reports again." |
* | * | "Opens an incident after about {time} of failed checks." |
*
* @param {Monitor_Form_NoteInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_form_note = /** @type {((inputs: Monitor_Form_NoteInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_Form_NoteInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.kind === "status_5xx") return /** @type {LocalizedString} */ (`Um status 5xx significa que o servidor falhou. Listado aqui, ele conta como no ar, e este monitor não vai chamar por ele.`);
		if (i?.kind === "quorum_all") return /** @type {LocalizedString} */ (`Todas as regiões precisam vê-lo fora do ar: uma queda que só algumas regiões veem não abre incidente. Uma região que para de reportar fica de fora até reportar de novo.`);
		return /** @type {LocalizedString} */ (`Abre um incidente depois de cerca de ${i?.time} de verificações com falha.`)
	}
	{
		if (i?.kind === "status_5xx") return /** @type {LocalizedString} */ (`A 5xx status means the server failed. Listed here, it counts as up, so this monitor won't page for it.`);
		if (i?.kind === "quorum_all") return /** @type {LocalizedString} */ (`Every region must see it down: an outage only some regions see won't open an incident. A region that stops reporting is left out until it reports again.`);
		return /** @type {LocalizedString} */ (`Opens an incident after about ${i?.time} of failed checks.`)
	}
});