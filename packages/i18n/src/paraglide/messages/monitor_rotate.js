/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown> }} Monitor_RotateInputs */



/**
* | part | output |
* | --- | --- |
* | "label" | "Heartbeat URL" |
* | "hint" | "Brigade keeps only a hash of it, so the current URL can't be shown again. A new one replaces it." |
* | "action" | "New URL" |
* | "prompt" | "Make a new URL for {name}?" |
* | "stops" | "The current URL stops working at once; update whatever pings it." |
* | "restart" | "The monitor starts over from Waiting, with a full interval and grace before a missed ping counts." |
* | "restart_alert" | "Its firing alert stays until the new URL is pinged." |
* | "unsaved" | "Your other changes in this form aren't saved." |
* | "confirm" | "Make new URL" |
* | "keep" | "Keep current URL" |
* | "shown" | "New URL for {name}, shown only once" |
* | * | "New URL" |
*
* @param {Monitor_RotateInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_rotate = /** @type {((inputs: Monitor_RotateInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_RotateInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "label") return /** @type {LocalizedString} */ (`URL de heartbeat`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`O Brigade guarda só um hash dela, então a URL atual não pode ser mostrada de novo. Uma nova URL substitui a atual.`);
		if (i?.part === "action") return /** @type {LocalizedString} */ (`Nova URL`);
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Criar uma nova URL para ${i?.name}?`);
		if (i?.part === "stops") return /** @type {LocalizedString} */ (`A URL atual para de funcionar na hora; atualize o que envia pings para ela.`);
		if (i?.part === "restart") return /** @type {LocalizedString} */ (`O monitor recomeça em Aguardando, com um intervalo e uma tolerância inteiros antes de um ping perdido contar.`);
		if (i?.part === "restart_alert") return /** @type {LocalizedString} */ (`O alerta ativo continua até a nova URL receber um ping.`);
		if (i?.part === "unsaved") return /** @type {LocalizedString} */ (`As outras alterações neste formulário não são salvas.`);
		if (i?.part === "confirm") return /** @type {LocalizedString} */ (`Criar nova URL`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter a URL atual`);
		if (i?.part === "shown") return /** @type {LocalizedString} */ (`Nova URL de ${i?.name}, mostrada só uma vez`);
		return /** @type {LocalizedString} */ (`Nova URL`)
	}
	{
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Heartbeat URL`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Brigade keeps only a hash of it, so the current URL can't be shown again. A new one replaces it.`);
		if (i?.part === "action") return /** @type {LocalizedString} */ (`New URL`);
		if (i?.part === "prompt") return /** @type {LocalizedString} */ (`Make a new URL for ${i?.name}?`);
		if (i?.part === "stops") return /** @type {LocalizedString} */ (`The current URL stops working at once; update whatever pings it.`);
		if (i?.part === "restart") return /** @type {LocalizedString} */ (`The monitor starts over from Waiting, with a full interval and grace before a missed ping counts.`);
		if (i?.part === "restart_alert") return /** @type {LocalizedString} */ (`Its firing alert stays until the new URL is pinged.`);
		if (i?.part === "unsaved") return /** @type {LocalizedString} */ (`Your other changes in this form aren't saved.`);
		if (i?.part === "confirm") return /** @type {LocalizedString} */ (`Make new URL`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep current URL`);
		if (i?.part === "shown") return /** @type {LocalizedString} */ (`New URL for ${i?.name}, shown only once`);
		return /** @type {LocalizedString} */ (`New URL`)
	}
});