/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ reason: NonNullable<unknown>, count: NonNullable<unknown> }} Timeline_Pages_FailedInputs */



/**
* | reason | countPlural | output |
* | --- | --- | --- |
* | "no_devices" | "one" | "Couldn't page {countFormatted} person: no registered device" |
* | "no_devices" | * | "Couldn't page {countFormatted} people: no registered device" |
* | "undelivered" | "one" | "Couldn't page {countFormatted} person: the push didn't go through" |
* | "undelivered" | * | "Couldn't page {countFormatted} people: the push didn't go through" |
* | "unsupported" | "one" | "Couldn't page {countFormatted} person: Brigade can't push to Android phones yet" |
* | "unsupported" | * | "Couldn't page {countFormatted} people: Brigade can't push to Android phones yet" |
* | "not_configured" | "one" | "Couldn't page {countFormatted} person: push notifications aren't set up on this server" |
* | "not_configured" | * | "Couldn't page {countFormatted} people: push notifications aren't set up on this server" |
* | "over_limit" | "one" | "Couldn't page {countFormatted} person: this page went to too many phones" |
* | "over_limit" | * | "Couldn't page {countFormatted} people: this page went to too many phones" |
* | "not_a_member" | "one" | "Couldn't page {countFormatted} person: no longer someone who can respond" |
* | "not_a_member" | * | "Couldn't page {countFormatted} people: no longer someone who can respond" |
* | * | "one" | "Couldn't page {countFormatted} person" |
* | * | * | "Couldn't page {countFormatted} people" |
*
* @param {Timeline_Pages_FailedInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const timeline_pages_failed = /** @type {((inputs: Timeline_Pages_FailedInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Timeline_Pages_FailedInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (i?.reason === "no_devices" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: nenhum aparelho registrado`);
		if (i?.reason === "undelivered" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: o push não foi entregue`);
		if (i?.reason === "unsupported" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: o Brigade ainda não envia pushes para Android`);
		if (i?.reason === "not_configured" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: as notificações push não estão configuradas neste servidor`);
		if (i?.reason === "over_limit" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: a chamada foi para celulares demais`);
		if (i?.reason === "not_a_member" && countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa: não é mais alguém que pode responder`);
		if (i?.reason === "no_devices") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: nenhum aparelho registrado`);
		if (i?.reason === "undelivered") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: o push não foi entregue`);
		if (i?.reason === "unsupported") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: o Brigade ainda não envia pushes para Android`);
		if (i?.reason === "not_configured") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: as notificações push não estão configuradas neste servidor`);
		if (i?.reason === "over_limit") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: a chamada foi para celulares demais`);
		if (i?.reason === "not_a_member") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas: não são mais pessoas que podem responder`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoa`);
		return /** @type {LocalizedString} */ (`Não foi possível chamar ${countFormatted} pessoas`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (i?.reason === "no_devices" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: no registered device`);
		if (i?.reason === "undelivered" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: the push didn't go through`);
		if (i?.reason === "unsupported" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: Brigade can't push to Android phones yet`);
		if (i?.reason === "not_configured" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: push notifications aren't set up on this server`);
		if (i?.reason === "over_limit" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: this page went to too many phones`);
		if (i?.reason === "not_a_member" && countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person: no longer someone who can respond`);
		if (i?.reason === "no_devices") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: no registered device`);
		if (i?.reason === "undelivered") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: the push didn't go through`);
		if (i?.reason === "unsupported") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: Brigade can't push to Android phones yet`);
		if (i?.reason === "not_configured") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: push notifications aren't set up on this server`);
		if (i?.reason === "over_limit") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: this page went to too many phones`);
		if (i?.reason === "not_a_member") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people: no longer someone who can respond`);
		if (countPlural === "one") return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} person`);
		return /** @type {LocalizedString} */ (`Couldn't page ${countFormatted} people`)
	}
});