/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown> }} Use_AppInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Use the app" |
* | "description" | "Brigade on your phone, for this workspace." |
* | "checking" | "Checking which app pages you here…" |
* | "store" | "Install the Brigade app from the App Store or Google Play, sign in with this account and allow notifications. That's where your pages arrive." |
* | "store_no_push" | "The Brigade app from the App Store or Google Play signs in to this workspace, so you can follow incidents from your phone." |
* | "own" | "Pages here go to your company's own build of the Brigade app. The Brigade app in the App Store and Google Play can't get them." |
* | "own_link" | "Get your company's app" |
* | "own_no_link" | "Ask an owner or admin where to get it." |
* | "failed" | "Couldn't check which app pages you here. Try again in a minute." |
* | * | "Use the app" |
*
* @param {Use_AppInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const use_app = /** @type {((inputs: Use_AppInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Use_AppInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Use o app`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`O Brigade no seu celular, para este workspace.`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando qual app aciona você aqui…`);
		if (i?.part === "store") return /** @type {LocalizedString} */ (`Instale o app do Brigade da App Store ou do Google Play, entre com esta conta e permita as notificações. É lá que seus acionamentos chegam.`);
		if (i?.part === "store_no_push") return /** @type {LocalizedString} */ (`O app do Brigade da App Store ou do Google Play entra neste workspace, para você acompanhar incidentes pelo celular.`);
		if (i?.part === "own") return /** @type {LocalizedString} */ (`Os acionamentos daqui vão para a versão própria da sua empresa do app do Brigade. O app do Brigade na App Store e no Google Play não os recebe.`);
		if (i?.part === "own_link") return /** @type {LocalizedString} */ (`Baixar o app da sua empresa`);
		if (i?.part === "own_no_link") return /** @type {LocalizedString} */ (`Pergunte a um owner ou admin onde baixá-lo.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível verificar qual app aciona você aqui. Tente de novo em um minuto.`);
		return /** @type {LocalizedString} */ (`Use o app`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Use the app`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Brigade on your phone, for this workspace.`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Checking which app pages you here…`);
		if (i?.part === "store") return /** @type {LocalizedString} */ (`Install the Brigade app from the App Store or Google Play, sign in with this account and allow notifications. That's where your pages arrive.`);
		if (i?.part === "store_no_push") return /** @type {LocalizedString} */ (`The Brigade app from the App Store or Google Play signs in to this workspace, so you can follow incidents from your phone.`);
		if (i?.part === "own") return /** @type {LocalizedString} */ (`Pages here go to your company's own build of the Brigade app. The Brigade app in the App Store and Google Play can't get them.`);
		if (i?.part === "own_link") return /** @type {LocalizedString} */ (`Get your company's app`);
		if (i?.part === "own_no_link") return /** @type {LocalizedString} */ (`Ask an owner or admin where to get it.`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't check which app pages you here. Try again in a minute.`);
		return /** @type {LocalizedString} */ (`Use the app`)
	}
});