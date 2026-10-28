/* eslint-disable */
import * as registry from '../registry.js'
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ kind: NonNullable<unknown>, count: NonNullable<unknown> }} Catalog_CountInputs */



/**
* | kind | count | countPlural | output |
* | --- | --- | --- | --- |
* | "services" | * | "one" | "{countFormatted} service" |
* | "services" | * | * | "{countFormatted} services" |
* | "types" | * | "one" | "{countFormatted} type" |
* | "types" | * | * | "{countFormatted} types" |
* | "fields" | * | "one" | "{countFormatted} field" |
* | "fields" | * | * | "{countFormatted} fields" |
* | "options" | * | "one" | "{countFormatted} option" |
* | "options" | * | * | "{countFormatted} options" |
* | "roles" | * | "one" | "{countFormatted} role" |
* | "roles" | * | * | "{countFormatted} roles" |
* | "missing" | * | "one" | "{countFormatted} required field to fill" |
* | "missing" | * | * | "{countFormatted} required fields to fill" |
* | "active" | * | "one" | "{countFormatted} active incident" |
* | "active" | * | * | "{countFormatted} active incidents" |
* | * | * | * | "{countFormatted}" |
*
* @param {Catalog_CountInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_count = /** @type {((inputs: Catalog_CountInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_CountInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		const countPlural = registry.plural("pt-BR", i?.count, {}, true);
		const countFormatted = registry.number("pt-BR", i?.count, {}, true);
		if (i?.kind === "services" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 serviços`);
		if (i?.kind === "types" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 tipos`);
		if (i?.kind === "fields" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 campos`);
		if (i?.kind === "options" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 opções`);
		if (i?.kind === "roles" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 papéis`);
		if (i?.kind === "missing" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 campos obrigatórios a preencher`);
		if (i?.kind === "active" && (i?.count === 0 || i?.count === "0")) return /** @type {LocalizedString} */ (`0 incidentes ativos`);
		if (i?.kind === "services" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} serviço`);
		if (i?.kind === "types" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} tipo`);
		if (i?.kind === "fields" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} campo`);
		if (i?.kind === "options" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} opção`);
		if (i?.kind === "roles" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} papel`);
		if (i?.kind === "missing" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} campo obrigatório a preencher`);
		if (i?.kind === "active" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} incidente ativo`);
		if (i?.kind === "services") return /** @type {LocalizedString} */ (`${countFormatted} serviços`);
		if (i?.kind === "types") return /** @type {LocalizedString} */ (`${countFormatted} tipos`);
		if (i?.kind === "fields") return /** @type {LocalizedString} */ (`${countFormatted} campos`);
		if (i?.kind === "options") return /** @type {LocalizedString} */ (`${countFormatted} opções`);
		if (i?.kind === "roles") return /** @type {LocalizedString} */ (`${countFormatted} papéis`);
		if (i?.kind === "missing") return /** @type {LocalizedString} */ (`${countFormatted} campos obrigatórios a preencher`);
		if (i?.kind === "active") return /** @type {LocalizedString} */ (`${countFormatted} incidentes ativos`);
		return /** @type {LocalizedString} */ (`${countFormatted}`)
	}
	{
		const countPlural = registry.plural("en", i?.count, {}, true);
		const countFormatted = registry.number("en", i?.count, {}, true);
		if (i?.kind === "services" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} service`);
		if (i?.kind === "types" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} type`);
		if (i?.kind === "fields" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} field`);
		if (i?.kind === "options" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} option`);
		if (i?.kind === "roles" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} role`);
		if (i?.kind === "missing" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} required field to fill`);
		if (i?.kind === "active" && countPlural === "one") return /** @type {LocalizedString} */ (`${countFormatted} active incident`);
		if (i?.kind === "services") return /** @type {LocalizedString} */ (`${countFormatted} services`);
		if (i?.kind === "types") return /** @type {LocalizedString} */ (`${countFormatted} types`);
		if (i?.kind === "fields") return /** @type {LocalizedString} */ (`${countFormatted} fields`);
		if (i?.kind === "options") return /** @type {LocalizedString} */ (`${countFormatted} options`);
		if (i?.kind === "roles") return /** @type {LocalizedString} */ (`${countFormatted} roles`);
		if (i?.kind === "missing") return /** @type {LocalizedString} */ (`${countFormatted} required fields to fill`);
		if (i?.kind === "active") return /** @type {LocalizedString} */ (`${countFormatted} active incidents`);
		return /** @type {LocalizedString} */ (`${countFormatted}`)
	}
});