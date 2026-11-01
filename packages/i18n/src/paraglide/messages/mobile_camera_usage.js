/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mobile_Camera_UsageInputs */



/**
* | output |
* | --- |
* | "Brigade uses the camera to scan the QR code on your Brigade dashboard, to add an instance or sign you in." |
*
* @param {Mobile_Camera_UsageInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const mobile_camera_usage = /** @type {((inputs?: Mobile_Camera_UsageInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_Camera_UsageInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((inputs = {}, options = {}) => {
	void inputs;
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") return /** @type {LocalizedString} */ ("O Brigade usa a câmera para ler o QR code do painel do Brigade, para adicionar uma instância ou entrar na sua conta.")
	return /** @type {LocalizedString} */ ("Brigade uses the camera to scan the QR code on your Brigade dashboard, to add an instance or sign you in.")
});