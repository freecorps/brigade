/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, device: NonNullable<unknown>, time: NonNullable<unknown> }} App_Sign_InInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Sign in with a QR code" |
* | "description" | "Signs the Brigade app in as you, with no password typed on the phone." |
* | "start" | "Show a sign-in code" |
* | "creating" | "Making a code…" |
* | "scan" | "On the Brigade app's sign-in screen, tap \"Scan a QR code\" and point the phone at this code." |
* | "never_share" | "Never share this code, nor the number your phone shows." |
* | "expires_in" | "Expires in {time}" |
* | "waiting" | "Waiting for your phone to scan the code." |
* | "qr_label" | "QR code that signs the Brigade app in as you" |
* | "cancel" | "Cancel" |
* | "claimed_title" | "{device} wants to sign in as you" |
* | "claimed_hint" | "Type the number your phone shows. If you didn't just scan this code, deny it." |
* | "number_label" | "Number on your phone" |
* | "number_invalid" | "Type the 2 digits your phone shows." |
* | "approve" | "Sign in" |
* | "approving" | "Checking…" |
* | "deny" | "Deny" |
* | "answer_failed" | "Couldn't send your answer. Try again." |
* | "approved" | "Approved. Finishing on your phone…" |
* | "signed_in" | "{device} is signed in as you." |
* | "another" | "Sign in another phone" |
* | "denied" | "Denied. Nobody was signed in." |
* | "wrong_number" | "That number didn't match, so nobody was signed in. If it was your phone, start again." |
* | "expired" | "This code expired before a phone used it." |
* | "again" | "Show a new code" |
* | "failed" | "Couldn't make a code. Try again in a minute." |
* | "rate_limited" | "Too many codes in a minute. Wait a moment and try again." |
* | "address_title" | "Only the address" |
* | "address_description" | "Adds this Brigade to the app without signing in, for a phone that signs in another way (with its password, or your company's sign-in)." |
* | "address_label" | "QR code with this Brigade's address" |
* | * | "Sign in with a QR code" |
*
* @param {App_Sign_InInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const app_sign_in = /** @type {((inputs: App_Sign_InInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<App_Sign_InInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Entrar com um QR code`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Entra no app do Brigade como você, sem digitar senha no celular.`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`Mostrar um código de acesso`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Gerando um código…`);
		if (i?.part === "scan") return /** @type {LocalizedString} */ (`Na tela de entrada do app do Brigade, toque em "Ler um QR code" e aponte o celular para este código.`);
		if (i?.part === "never_share") return /** @type {LocalizedString} */ (`Nunca compartilhe este código, nem o número que seu celular mostrar.`);
		if (i?.part === "expires_in") return /** @type {LocalizedString} */ (`Expira em ${i?.time}`);
		if (i?.part === "waiting") return /** @type {LocalizedString} */ (`Esperando seu celular ler o código.`);
		if (i?.part === "qr_label") return /** @type {LocalizedString} */ (`QR code que entra no app do Brigade como você`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "claimed_title") return /** @type {LocalizedString} */ (`${i?.device} quer entrar como você`);
		if (i?.part === "claimed_hint") return /** @type {LocalizedString} */ (`Digite o número que seu celular mostra. Se você não acabou de ler este código, recuse.`);
		if (i?.part === "number_label") return /** @type {LocalizedString} */ (`Número no seu celular`);
		if (i?.part === "number_invalid") return /** @type {LocalizedString} */ (`Digite os 2 dígitos que seu celular mostra.`);
		if (i?.part === "approve") return /** @type {LocalizedString} */ (`Entrar`);
		if (i?.part === "approving") return /** @type {LocalizedString} */ (`Verificando…`);
		if (i?.part === "deny") return /** @type {LocalizedString} */ (`Recusar`);
		if (i?.part === "answer_failed") return /** @type {LocalizedString} */ (`Não foi possível enviar sua resposta. Tente de novo.`);
		if (i?.part === "approved") return /** @type {LocalizedString} */ (`Aprovado. Terminando no seu celular…`);
		if (i?.part === "signed_in") return /** @type {LocalizedString} */ (`${i?.device} entrou como você.`);
		if (i?.part === "another") return /** @type {LocalizedString} */ (`Entrar em outro celular`);
		if (i?.part === "denied") return /** @type {LocalizedString} */ (`Recusado. Ninguém entrou.`);
		if (i?.part === "wrong_number") return /** @type {LocalizedString} */ (`O número não confere, então ninguém entrou. Se era o seu celular, comece de novo.`);
		if (i?.part === "expired") return /** @type {LocalizedString} */ (`Este código expirou antes de um celular usá-lo.`);
		if (i?.part === "again") return /** @type {LocalizedString} */ (`Mostrar um novo código`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Não foi possível gerar um código. Tente de novo em um minuto.`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`Códigos demais em um minuto. Espere um pouco e tente de novo.`);
		if (i?.part === "address_title") return /** @type {LocalizedString} */ (`Só o endereço`);
		if (i?.part === "address_description") return /** @type {LocalizedString} */ (`Adiciona este Brigade ao app sem entrar, para um celular que entra de outro jeito (com a senha, ou o acesso da sua empresa).`);
		if (i?.part === "address_label") return /** @type {LocalizedString} */ (`QR code com o endereço deste Brigade`);
		return /** @type {LocalizedString} */ (`Entrar com um QR code`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Sign in with a QR code`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Signs the Brigade app in as you, with no password typed on the phone.`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`Show a sign-in code`);
		if (i?.part === "creating") return /** @type {LocalizedString} */ (`Making a code…`);
		if (i?.part === "scan") return /** @type {LocalizedString} */ (`On the Brigade app's sign-in screen, tap "Scan a QR code" and point the phone at this code.`);
		if (i?.part === "never_share") return /** @type {LocalizedString} */ (`Never share this code, nor the number your phone shows.`);
		if (i?.part === "expires_in") return /** @type {LocalizedString} */ (`Expires in ${i?.time}`);
		if (i?.part === "waiting") return /** @type {LocalizedString} */ (`Waiting for your phone to scan the code.`);
		if (i?.part === "qr_label") return /** @type {LocalizedString} */ (`QR code that signs the Brigade app in as you`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "claimed_title") return /** @type {LocalizedString} */ (`${i?.device} wants to sign in as you`);
		if (i?.part === "claimed_hint") return /** @type {LocalizedString} */ (`Type the number your phone shows. If you didn't just scan this code, deny it.`);
		if (i?.part === "number_label") return /** @type {LocalizedString} */ (`Number on your phone`);
		if (i?.part === "number_invalid") return /** @type {LocalizedString} */ (`Type the 2 digits your phone shows.`);
		if (i?.part === "approve") return /** @type {LocalizedString} */ (`Sign in`);
		if (i?.part === "approving") return /** @type {LocalizedString} */ (`Checking…`);
		if (i?.part === "deny") return /** @type {LocalizedString} */ (`Deny`);
		if (i?.part === "answer_failed") return /** @type {LocalizedString} */ (`Couldn't send your answer. Try again.`);
		if (i?.part === "approved") return /** @type {LocalizedString} */ (`Approved. Finishing on your phone…`);
		if (i?.part === "signed_in") return /** @type {LocalizedString} */ (`${i?.device} is signed in as you.`);
		if (i?.part === "another") return /** @type {LocalizedString} */ (`Sign in another phone`);
		if (i?.part === "denied") return /** @type {LocalizedString} */ (`Denied. Nobody was signed in.`);
		if (i?.part === "wrong_number") return /** @type {LocalizedString} */ (`That number didn't match, so nobody was signed in. If it was your phone, start again.`);
		if (i?.part === "expired") return /** @type {LocalizedString} */ (`This code expired before a phone used it.`);
		if (i?.part === "again") return /** @type {LocalizedString} */ (`Show a new code`);
		if (i?.part === "failed") return /** @type {LocalizedString} */ (`Couldn't make a code. Try again in a minute.`);
		if (i?.part === "rate_limited") return /** @type {LocalizedString} */ (`Too many codes in a minute. Wait a moment and try again.`);
		if (i?.part === "address_title") return /** @type {LocalizedString} */ (`Only the address`);
		if (i?.part === "address_description") return /** @type {LocalizedString} */ (`Adds this Brigade to the app without signing in, for a phone that signs in another way (with its password, or your company's sign-in).`);
		if (i?.part === "address_label") return /** @type {LocalizedString} */ (`QR code with this Brigade's address`);
		return /** @type {LocalizedString} */ (`Sign in with a QR code`)
	}
});