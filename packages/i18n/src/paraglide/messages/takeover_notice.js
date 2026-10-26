/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Takeover_NoticeInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "You took this account back" |
* | "body" | "Someone signed up with your email address before you confirmed it, and created the workspaces below. They're yours now. So nobody else can page you through w..." |
* | "after" | "Resume the monitors you want to keep. A heartbeat needs a new monitor to get a new URL. Check each workspace's on-call schedules and escalation policies too." |
* | "failed" | "Brigade couldn't reach this workspace, so nothing in it was paused. Check its monitors now." |
* | "nothing" | "It had no monitors." |
* | "dismiss" | "Got it" |
* | "dismissing" | "Hiding…" |
* | "dismiss_failed" | "Couldn't hide this notice. Try again." |
* | * | "You took this account back" |
*
* @param {Takeover_NoticeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const takeover_notice = /** @type {((inputs: Takeover_NoticeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Takeover_NoticeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Você recuperou esta conta`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`Alguém se cadastrou com o seu e-mail antes de você confirmá-lo e criou os espaços de trabalho abaixo. Agora eles são seus. Para que ninguém mais possa acionar você pelo que foi configurado ali, o Brigade pausou todos os monitores e desativou as URLs de heartbeat.`);
		if (i?.part === "after") return /** @type {LocalizedString} */ (`Retome os monitores que quiser manter. Um heartbeat precisa de um novo monitor para ter uma nova URL. Confira também as escalas e as políticas de escalonamento de cada espaço de trabalho.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acessar este espaço de trabalho, então nada nele foi pausado. Confira os monitores agora.`);
		if (i?.part === "nothing") return /** @type {LocalizedString} */ (`Não havia monitores.`);
		if (i?.part === "dismiss") return /** @type {LocalizedString} */ (`Entendi`);
		if (i?.part === "dismissing") return /** @type {LocalizedString} */ (`Ocultando…`);
		if (i?.part === "dismiss_failed") return /** @type {LocalizedString} */ (`Não foi possível ocultar este aviso. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Você recuperou esta conta`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`You took this account back`);
		if (i?.part === "body") return /** @type {LocalizedString} */ (`Someone signed up with your email address before you confirmed it, and created the workspaces below. They're yours now. So nobody else can page you through what they set up, Brigade paused every monitor there and turned off their heartbeat URLs.`);
		if (i?.part === "after") return /** @type {LocalizedString} */ (`Resume the monitors you want to keep. A heartbeat needs a new monitor to get a new URL. Check each workspace's on-call schedules and escalation policies too.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Brigade couldn't reach this workspace, so nothing in it was paused. Check its monitors now.`);
		if (i?.part === "nothing") return /** @type {LocalizedString} */ (`It had no monitors.`);
		if (i?.part === "dismiss") return /** @type {LocalizedString} */ (`Got it`);
		if (i?.part === "dismissing") return /** @type {LocalizedString} */ (`Hiding…`);
		if (i?.part === "dismiss_failed") return /** @type {LocalizedString} */ (`Couldn't hide this notice. Try again.`);
		return /** @type {LocalizedString} */ (`You took this account back`)
	}
});