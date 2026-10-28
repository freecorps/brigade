/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, workspace: NonNullable<unknown>, member: NonNullable<unknown>, schedule: NonNullable<unknown> }} Email_RotationInputs */



/**
* | part | output |
* | --- | --- |
* | "subject" | "{member} was taken out of on-call schedules in {workspace}" |
* | "intro_removed" | "{member} was removed from {workspace}, so Brigade took them out of these on-call schedules:" |
* | "intro_left" | "{member} left {workspace}, so Brigade took them out of these on-call schedules:" |
* | "intro_viewer" | "{member} is now a viewer in {workspace}, and viewers aren't on call, so Brigade took them out of these on-call schedules:" |
* | "item" | "{schedule}" |
* | "item_emptied" | "{schedule}: one of its layers has nobody in it now" |
* | "how" | "The others in each rotation moved up to cover the shifts, and their overrides were deleted. Check that the new handoffs suit everyone." |
* | "someone" | "A member" |
* | "open" | "Open the schedules" |
* | "footer" | "You get this email because you're an owner of {workspace} on Brigade." |
* | * | "{member} was taken out of on-call schedules in {workspace}" |
*
* @param {Email_RotationInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const email_rotation = /** @type {((inputs: Email_RotationInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Email_RotationInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`${i?.member} saiu das escalas de plantão em ${i?.workspace}`);
		if (i?.part === "intro_removed") return /** @type {LocalizedString} */ (`Removeram ${i?.member} de ${i?.workspace}, então o Brigade tirou essa pessoa destas escalas de plantão:`);
		if (i?.part === "intro_left") return /** @type {LocalizedString} */ (`${i?.member} saiu de ${i?.workspace}, então o Brigade tirou essa pessoa destas escalas de plantão:`);
		if (i?.part === "intro_viewer") return /** @type {LocalizedString} */ (`${i?.member} agora é leitor em ${i?.workspace}, e leitores não ficam de plantão, então o Brigade tirou essa pessoa destas escalas de plantão:`);
		if (i?.part === "item") return /** @type {LocalizedString} */ (`${i?.schedule}`);
		if (i?.part === "item_emptied") return /** @type {LocalizedString} */ (`${i?.schedule}: uma das camadas está sem ninguém agora`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`Os outros de cada rodízio avançaram para cobrir os turnos, e as substituições dessa pessoa foram apagadas. Confira se as novas passagens de turno servem para todos.`);
		if (i?.part === "someone") return /** @type {LocalizedString} */ (`Um membro`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir as escalas`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`Você recebe este email porque é proprietário de ${i?.workspace} no Brigade.`);
		return /** @type {LocalizedString} */ (`${i?.member} saiu das escalas de plantão em ${i?.workspace}`)
	}
	{
		if (i?.part === "subject") return /** @type {LocalizedString} */ (`${i?.member} was taken out of on-call schedules in ${i?.workspace}`);
		if (i?.part === "intro_removed") return /** @type {LocalizedString} */ (`${i?.member} was removed from ${i?.workspace}, so Brigade took them out of these on-call schedules:`);
		if (i?.part === "intro_left") return /** @type {LocalizedString} */ (`${i?.member} left ${i?.workspace}, so Brigade took them out of these on-call schedules:`);
		if (i?.part === "intro_viewer") return /** @type {LocalizedString} */ (`${i?.member} is now a viewer in ${i?.workspace}, and viewers aren't on call, so Brigade took them out of these on-call schedules:`);
		if (i?.part === "item") return /** @type {LocalizedString} */ (`${i?.schedule}`);
		if (i?.part === "item_emptied") return /** @type {LocalizedString} */ (`${i?.schedule}: one of its layers has nobody in it now`);
		if (i?.part === "how") return /** @type {LocalizedString} */ (`The others in each rotation moved up to cover the shifts, and their overrides were deleted. Check that the new handoffs suit everyone.`);
		if (i?.part === "someone") return /** @type {LocalizedString} */ (`A member`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open the schedules`);
		if (i?.part === "footer") return /** @type {LocalizedString} */ (`You get this email because you're an owner of ${i?.workspace} on Brigade.`);
		return /** @type {LocalizedString} */ (`${i?.member} was taken out of on-call schedules in ${i?.workspace}`)
	}
});