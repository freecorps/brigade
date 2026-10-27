/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, count: NonNullable<unknown>, max: NonNullable<unknown> }} Monitor_CapInputs */



/**
* | part | output |
* | --- | --- |
* | "limit" | "Limit {max}" |
* | "edit" | "Change limit" |
* | "label" | "Monitor limit" |
* | "hint" | "At most {max} on this instance. Leave it empty to use that." |
* | "below" | "This workspace has {count} monitors already. They keep running, but no new one can be added until some are deleted." |
* | "invalid" | "Use a whole number from 1 to {max}, or leave it empty." |
* | "save" | "Save limit" |
* | * | "Monitor limit" |
*
* @param {Monitor_CapInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const monitor_cap = /** @type {((inputs: Monitor_CapInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Monitor_CapInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Limite ${i?.max}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Alterar limite`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Limite de monitores`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`No máximo ${i?.max} nesta instância. Deixe vazio para usar esse valor.`);
		if (i?.part === "below") return /** @type {LocalizedString} */ (`Este workspace já tem ${i?.count} monitores. Eles continuam rodando, mas nenhum novo pode ser adicionado até que alguns sejam excluídos.`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Use um número inteiro de 1 a ${i?.max}, ou deixe vazio.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar limite`);
		return /** @type {LocalizedString} */ (`Limite de monitores`)
	}
	{
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Limit ${i?.max}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Change limit`);
		if (i?.part === "label") return /** @type {LocalizedString} */ (`Monitor limit`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`At most ${i?.max} on this instance. Leave it empty to use that.`);
		if (i?.part === "below") return /** @type {LocalizedString} */ (`This workspace has ${i?.count} monitors already. They keep running, but no new one can be added until some are deleted.`);
		if (i?.part === "invalid") return /** @type {LocalizedString} */ (`Use a whole number from 1 to ${i?.max}, or leave it empty.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save limit`);
		return /** @type {LocalizedString} */ (`Monitor limit`)
	}
});