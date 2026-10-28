/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ choice: NonNullable<unknown> }} Escalation_Min_SeverityInputs */



/**
* | choice | output |
* | --- | --- |
* | "every" | "Every severity" |
* | "sev1" | "SEV1 only" |
* | "sev2" | "SEV2 and SEV1" |
* | "sev3" | "SEV3, SEV2 and SEV1" |
* | "summary_sev1" | "Escalates for SEV1 only" |
* | "summary_sev2" | "Escalates for SEV2 and SEV1" |
* | "summary_sev3" | "Escalates for SEV3, SEV2 and SEV1" |
* | * | "Every severity" |
*
* @param {Escalation_Min_SeverityInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const escalation_min_severity = /** @type {((inputs: Escalation_Min_SeverityInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escalation_Min_SeverityInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.choice === "every") return /** @type {LocalizedString} */ (`Todas as severidades`);
		if (i?.choice === "sev1") return /** @type {LocalizedString} */ (`Só SEV1`);
		if (i?.choice === "sev2") return /** @type {LocalizedString} */ (`SEV2 e SEV1`);
		if (i?.choice === "sev3") return /** @type {LocalizedString} */ (`SEV3, SEV2 e SEV1`);
		if (i?.choice === "summary_sev1") return /** @type {LocalizedString} */ (`Escala só para SEV1`);
		if (i?.choice === "summary_sev2") return /** @type {LocalizedString} */ (`Escala para SEV2 e SEV1`);
		if (i?.choice === "summary_sev3") return /** @type {LocalizedString} */ (`Escala para SEV3, SEV2 e SEV1`);
		return /** @type {LocalizedString} */ (`Todas as severidades`)
	}
	{
		if (i?.choice === "every") return /** @type {LocalizedString} */ (`Every severity`);
		if (i?.choice === "sev1") return /** @type {LocalizedString} */ (`SEV1 only`);
		if (i?.choice === "sev2") return /** @type {LocalizedString} */ (`SEV2 and SEV1`);
		if (i?.choice === "sev3") return /** @type {LocalizedString} */ (`SEV3, SEV2 and SEV1`);
		if (i?.choice === "summary_sev1") return /** @type {LocalizedString} */ (`Escalates for SEV1 only`);
		if (i?.choice === "summary_sev2") return /** @type {LocalizedString} */ (`Escalates for SEV2 and SEV1`);
		if (i?.choice === "summary_sev3") return /** @type {LocalizedString} */ (`Escalates for SEV3, SEV2 and SEV1`);
		return /** @type {LocalizedString} */ (`Every severity`)
	}
});