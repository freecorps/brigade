/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ env: NonNullable<unknown>, part: NonNullable<unknown> }} EnvironmentInputs */



/**
* | env | part | output |
* | --- | --- | --- |
* | "local" | "badge" | "Local" |
* | "local" | "overview" | "The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine." |
* | "local" | "stack" | "Local stack" |
* | "local" | "checking" | "Checking the local stack…" |
* | "dev" | "badge" | "Dev" |
* | "dev" | "overview" | "A development deployment on Cloudflare, for trying changes: the dashboard, its Worker, the API Worker and a Durable Object." |
* | "dev" | "stack" | "Dev stack" |
* | "dev" | "checking" | "Checking the dev stack…" |
* | "staging" | "badge" | "Staging" |
* | "staging" | "overview" | "A staging deployment on Cloudflare, for trying a release before production: the dashboard, its Worker, the API Worker and a Durable Object." |
* | "staging" | "stack" | "Staging stack" |
* | "staging" | "checking" | "Checking the staging stack…" |
* | * | "overview" | "Your workspace's incidents, who is on call, and who gets paged." |
* | * | "stack" | "Services" |
* | * | "checking" | "Checking the services…" |
* | * | "hint" | "Look for the error in this deployment's Worker logs, then check again." |
* | * | * | "Brigade" |
*
* @param {EnvironmentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const environment = /** @type {((inputs: EnvironmentInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<EnvironmentInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.env === "local" && i?.part === "badge") return /** @type {LocalizedString} */ (`Local`);
		if (i?.env === "local" && i?.part === "overview") return /** @type {LocalizedString} */ (`O painel, o Worker dele, o Worker da API e um Durable Object, tudo rodando na sua máquina.`);
		if (i?.env === "local" && i?.part === "stack") return /** @type {LocalizedString} */ (`Stack local`);
		if (i?.env === "local" && i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando a stack local…`);
		if (i?.env === "dev" && i?.part === "badge") return /** @type {LocalizedString} */ (`Dev`);
		if (i?.env === "dev" && i?.part === "overview") return /** @type {LocalizedString} */ (`Um ambiente de desenvolvimento na Cloudflare, para testar mudanças: o painel, o Worker dele, o Worker da API e um Durable Object.`);
		if (i?.env === "dev" && i?.part === "stack") return /** @type {LocalizedString} */ (`Stack de dev`);
		if (i?.env === "dev" && i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando a stack de dev…`);
		if (i?.env === "staging" && i?.part === "badge") return /** @type {LocalizedString} */ (`Staging`);
		if (i?.env === "staging" && i?.part === "overview") return /** @type {LocalizedString} */ (`Um ambiente de staging na Cloudflare, para testar uma versão antes da produção: o painel, o Worker dele, o Worker da API e um Durable Object.`);
		if (i?.env === "staging" && i?.part === "stack") return /** @type {LocalizedString} */ (`Stack de staging`);
		if (i?.env === "staging" && i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando a stack de staging…`);
		if (i?.part === "overview") return /** @type {LocalizedString} */ (`Os incidentes do seu workspace, quem está de plantão e quem é acionado.`);
		if (i?.part === "stack") return /** @type {LocalizedString} */ (`Serviços`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando os serviços…`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Procure o erro nos logs do Worker deste ambiente e verifique de novo.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
	{
		if (i?.env === "local" && i?.part === "badge") return /** @type {LocalizedString} */ (`Local`);
		if (i?.env === "local" && i?.part === "overview") return /** @type {LocalizedString} */ (`The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine.`);
		if (i?.env === "local" && i?.part === "stack") return /** @type {LocalizedString} */ (`Local stack`);
		if (i?.env === "local" && i?.part === "checking") return /** @type {LocalizedString} */ (`Checking the local stack…`);
		if (i?.env === "dev" && i?.part === "badge") return /** @type {LocalizedString} */ (`Dev`);
		if (i?.env === "dev" && i?.part === "overview") return /** @type {LocalizedString} */ (`A development deployment on Cloudflare, for trying changes: the dashboard, its Worker, the API Worker and a Durable Object.`);
		if (i?.env === "dev" && i?.part === "stack") return /** @type {LocalizedString} */ (`Dev stack`);
		if (i?.env === "dev" && i?.part === "checking") return /** @type {LocalizedString} */ (`Checking the dev stack…`);
		if (i?.env === "staging" && i?.part === "badge") return /** @type {LocalizedString} */ (`Staging`);
		if (i?.env === "staging" && i?.part === "overview") return /** @type {LocalizedString} */ (`A staging deployment on Cloudflare, for trying a release before production: the dashboard, its Worker, the API Worker and a Durable Object.`);
		if (i?.env === "staging" && i?.part === "stack") return /** @type {LocalizedString} */ (`Staging stack`);
		if (i?.env === "staging" && i?.part === "checking") return /** @type {LocalizedString} */ (`Checking the staging stack…`);
		if (i?.part === "overview") return /** @type {LocalizedString} */ (`Your workspace's incidents, who is on call, and who gets paged.`);
		if (i?.part === "stack") return /** @type {LocalizedString} */ (`Services`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Checking the services…`);
		if (i?.part === "hint") return /** @type {LocalizedString} */ (`Look for the error in this deployment's Worker logs, then check again.`);
		return /** @type {LocalizedString} */ (`Brigade`)
	}
});