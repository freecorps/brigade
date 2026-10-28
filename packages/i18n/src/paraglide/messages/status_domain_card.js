/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown> }} Status_Domain_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Custom domain" |
* | "description" | "Serve the status page at your own address, such as status.example.com. Cloudflare issues its certificate once the DNS records below are in place." |
* | "not_set_up" | "Set up the status page first to give it a domain." |
* | "none" | "The status page has no domain of its own." |
* | "viewer" | "Owners and admins can add or remove the domain." |
* | "hostname_label" | "Domain" |
* | "hostname_hint" | "A subdomain you control, such as status.example.com. Point a CNAME at {name}." |
* | "add" | "Add domain" |
* | "adding" | "Adding…" |
* | "state_pending" | "Pending" |
* | "state_active" | "Active" |
* | "state_failed" | "Failed" |
* | "explain_pending" | "Create these DNS records where your domain is hosted, then check again. It can take a few minutes after the records are in place." |
* | "explain_active" | "The status page is served at this domain." |
* | "explain_failed" | "Cloudflare couldn't verify the domain. Check the records, then check again, or remove the domain and add it again." |
* | "records_title" | "DNS records to create" |
* | "record_name" | "Name" |
* | "record_value" | "Value" |
* | "checked" | "Last checked {time}" |
* | "check" | "Check again" |
* | "checking" | "Checking…" |
* | "remove" | "Remove domain" |
* | "removing" | "Removing…" |
* | "keep" | "Keep" |
* | "remove_confirm" | "Remove {name}? The status page stops answering there right away; its usual address keeps working." |
* | "error_required" | "Enter a domain." |
* | "error_invalid_hostname" | "That isn't a domain. Enter a name like status.example.com, without https:// or a path." |
* | "error_own_domain" | "That domain belongs to this Brigade instance. Use one of your own." |
* | "error_hostname_taken" | "That domain is already in use by another status page." |
* | "error_domain_exists" | "The status page already has a domain. Remove it first." |
* | "error_not_configured" | "This Brigade instance has no custom domains set up." |
* | "error_forbidden" | "Only owners and admins can change the domain." |
* | "error_rate_limited" | "Too many changes in a minute. Try again shortly." |
* | "error_not_found" | "The domain is no longer on the status page." |
* | "error_cloudflare_failed" | "Cloudflare didn't answer. Try again in a minute." |
* | "error_apex" | "Use a subdomain, such as status.example.com: a CNAME can't point the domain itself here." |
* | "error_in_progress" | "That domain is still being set up or cleaned up. Try again in a few minutes." |
* | "error_unavailable" | "Brigade couldn't save the domain right now. Try again in a minute." |
* | "reason_dns" | "Cloudflare can't see the DNS records yet. Check they match the ones below; new records can take a while to show." |
* | "reason_caa" | "A CAA record on the domain doesn't allow Cloudflare's certificate authorities. Allow them, then check again." |
* | "reason_timed_out" | "Cloudflare stopped waiting for the records. Check them, then remove the domain and add it again." |
* | "reason_expired" | "The domain's certificate expired. Check the records are still in place, then check again." |
* | "reason_moved" | "The domain no longer points at this Brigade instance. Put the CNAME back, then check again." |
* | "reason_blocked" | "Cloudflare blocked this domain. Remove it, or use another one." |
* | "reason_deleted" | "Cloudflare no longer has this domain. Remove it and add it again." |
* | "reason_other" | "Cloudflare couldn't verify the domain. Check the records, then check again." |
* | "error_failed" | "Couldn't save. Try again." |
* | * | "Custom domain" |
*
* @param {Status_Domain_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_domain_card = /** @type {((inputs: Status_Domain_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_Domain_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Domínio próprio`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Sirva a página de status no seu próprio endereço, como status.example.com. A Cloudflare emite o certificado assim que os registros DNS abaixo estiverem configurados.`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`Configure a página de status antes de dar um domínio a ela.`);
		if (i?.part === "none") return /** @type {LocalizedString} */ (`A página de status não tem domínio próprio.`);
		if (i?.part === "viewer") return /** @type {LocalizedString} */ (`Donos e administradores podem adicionar ou remover o domínio.`);
		if (i?.part === "hostname_label") return /** @type {LocalizedString} */ (`Domínio`);
		if (i?.part === "hostname_hint") return /** @type {LocalizedString} */ (`Um subdomínio que você controla, como status.example.com. Aponte um CNAME para ${i?.name}.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar domínio`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Adicionando…`);
		if (i?.part === "state_pending") return /** @type {LocalizedString} */ (`Pendente`);
		if (i?.part === "state_active") return /** @type {LocalizedString} */ (`Ativo`);
		if (i?.part === "state_failed") return /** @type {LocalizedString} */ (`Falhou`);
		if (i?.part === "explain_pending") return /** @type {LocalizedString} */ (`Crie estes registros DNS onde seu domínio está hospedado e verifique de novo. Pode levar alguns minutos depois que os registros estiverem no ar.`);
		if (i?.part === "explain_active") return /** @type {LocalizedString} */ (`A página de status é servida neste domínio.`);
		if (i?.part === "explain_failed") return /** @type {LocalizedString} */ (`A Cloudflare não conseguiu verificar o domínio. Confira os registros e verifique de novo, ou remova o domínio e adicione outra vez.`);
		if (i?.part === "records_title") return /** @type {LocalizedString} */ (`Registros DNS a criar`);
		if (i?.part === "record_name") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.part === "record_value") return /** @type {LocalizedString} */ (`Valor`);
		if (i?.part === "checked") return /** @type {LocalizedString} */ (`Verificado pela última vez em ${i?.time}`);
		if (i?.part === "check") return /** @type {LocalizedString} */ (`Verificar de novo`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Verificando…`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover domínio`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removendo…`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Remover ${i?.name}? A página de status deixa de responder lá na hora; o endereço de sempre continua funcionando.`);
		if (i?.part === "error_required") return /** @type {LocalizedString} */ (`Informe um domínio.`);
		if (i?.part === "error_invalid_hostname") return /** @type {LocalizedString} */ (`Isso não é um domínio. Informe um nome como status.example.com, sem https:// nem caminho.`);
		if (i?.part === "error_own_domain") return /** @type {LocalizedString} */ (`Esse domínio pertence a esta instância do Brigade. Use um seu.`);
		if (i?.part === "error_hostname_taken") return /** @type {LocalizedString} */ (`Esse domínio já está em uso por outra página de status.`);
		if (i?.part === "error_domain_exists") return /** @type {LocalizedString} */ (`A página de status já tem um domínio. Remova-o primeiro.`);
		if (i?.part === "error_not_configured") return /** @type {LocalizedString} */ (`Esta instância do Brigade não tem domínios próprios configurados.`);
		if (i?.part === "error_forbidden") return /** @type {LocalizedString} */ (`Só donos e administradores podem mudar o domínio.`);
		if (i?.part === "error_rate_limited") return /** @type {LocalizedString} */ (`Muitas mudanças em um minuto. Tente de novo em instantes.`);
		if (i?.part === "error_not_found") return /** @type {LocalizedString} */ (`O domínio não está mais na página de status.`);
		if (i?.part === "error_cloudflare_failed") return /** @type {LocalizedString} */ (`A Cloudflare não respondeu. Tente de novo em um minuto.`);
		if (i?.part === "error_apex") return /** @type {LocalizedString} */ (`Use um subdomínio, como status.example.com: um CNAME não consegue apontar o próprio domínio para cá.`);
		if (i?.part === "error_in_progress") return /** @type {LocalizedString} */ (`Esse domínio ainda está sendo configurado ou removido. Tente de novo em alguns minutos.`);
		if (i?.part === "error_unavailable") return /** @type {LocalizedString} */ (`O Brigade não conseguiu salvar o domínio agora. Tente de novo em um minuto.`);
		if (i?.part === "reason_dns") return /** @type {LocalizedString} */ (`A Cloudflare ainda não encontra os registros DNS. Confira se batem com os abaixo; registros novos podem demorar a aparecer.`);
		if (i?.part === "reason_caa") return /** @type {LocalizedString} */ (`Um registro CAA no domínio não permite as autoridades certificadoras da Cloudflare. Permita-as e verifique de novo.`);
		if (i?.part === "reason_timed_out") return /** @type {LocalizedString} */ (`A Cloudflare parou de esperar pelos registros. Confira-os, remova o domínio e adicione de novo.`);
		if (i?.part === "reason_expired") return /** @type {LocalizedString} */ (`O certificado do domínio expirou. Confira se os registros continuam no lugar e verifique de novo.`);
		if (i?.part === "reason_moved") return /** @type {LocalizedString} */ (`O domínio não aponta mais para esta instância do Brigade. Recoloque o CNAME e verifique de novo.`);
		if (i?.part === "reason_blocked") return /** @type {LocalizedString} */ (`A Cloudflare bloqueou este domínio. Remova-o ou use outro.`);
		if (i?.part === "reason_deleted") return /** @type {LocalizedString} */ (`A Cloudflare não tem mais este domínio. Remova-o e adicione de novo.`);
		if (i?.part === "reason_other") return /** @type {LocalizedString} */ (`A Cloudflare não conseguiu verificar o domínio. Confira os registros e verifique de novo.`);
		if (i?.part === "error_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Domínio próprio`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Custom domain`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Serve the status page at your own address, such as status.example.com. Cloudflare issues its certificate once the DNS records below are in place.`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`Set up the status page first to give it a domain.`);
		if (i?.part === "none") return /** @type {LocalizedString} */ (`The status page has no domain of its own.`);
		if (i?.part === "viewer") return /** @type {LocalizedString} */ (`Owners and admins can add or remove the domain.`);
		if (i?.part === "hostname_label") return /** @type {LocalizedString} */ (`Domain`);
		if (i?.part === "hostname_hint") return /** @type {LocalizedString} */ (`A subdomain you control, such as status.example.com. Point a CNAME at ${i?.name}.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add domain`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Adding…`);
		if (i?.part === "state_pending") return /** @type {LocalizedString} */ (`Pending`);
		if (i?.part === "state_active") return /** @type {LocalizedString} */ (`Active`);
		if (i?.part === "state_failed") return /** @type {LocalizedString} */ (`Failed`);
		if (i?.part === "explain_pending") return /** @type {LocalizedString} */ (`Create these DNS records where your domain is hosted, then check again. It can take a few minutes after the records are in place.`);
		if (i?.part === "explain_active") return /** @type {LocalizedString} */ (`The status page is served at this domain.`);
		if (i?.part === "explain_failed") return /** @type {LocalizedString} */ (`Cloudflare couldn't verify the domain. Check the records, then check again, or remove the domain and add it again.`);
		if (i?.part === "records_title") return /** @type {LocalizedString} */ (`DNS records to create`);
		if (i?.part === "record_name") return /** @type {LocalizedString} */ (`Name`);
		if (i?.part === "record_value") return /** @type {LocalizedString} */ (`Value`);
		if (i?.part === "checked") return /** @type {LocalizedString} */ (`Last checked ${i?.time}`);
		if (i?.part === "check") return /** @type {LocalizedString} */ (`Check again`);
		if (i?.part === "checking") return /** @type {LocalizedString} */ (`Checking…`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove domain`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removing…`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Remove ${i?.name}? The status page stops answering there right away; its usual address keeps working.`);
		if (i?.part === "error_required") return /** @type {LocalizedString} */ (`Enter a domain.`);
		if (i?.part === "error_invalid_hostname") return /** @type {LocalizedString} */ (`That isn't a domain. Enter a name like status.example.com, without https:// or a path.`);
		if (i?.part === "error_own_domain") return /** @type {LocalizedString} */ (`That domain belongs to this Brigade instance. Use one of your own.`);
		if (i?.part === "error_hostname_taken") return /** @type {LocalizedString} */ (`That domain is already in use by another status page.`);
		if (i?.part === "error_domain_exists") return /** @type {LocalizedString} */ (`The status page already has a domain. Remove it first.`);
		if (i?.part === "error_not_configured") return /** @type {LocalizedString} */ (`This Brigade instance has no custom domains set up.`);
		if (i?.part === "error_forbidden") return /** @type {LocalizedString} */ (`Only owners and admins can change the domain.`);
		if (i?.part === "error_rate_limited") return /** @type {LocalizedString} */ (`Too many changes in a minute. Try again shortly.`);
		if (i?.part === "error_not_found") return /** @type {LocalizedString} */ (`The domain is no longer on the status page.`);
		if (i?.part === "error_cloudflare_failed") return /** @type {LocalizedString} */ (`Cloudflare didn't answer. Try again in a minute.`);
		if (i?.part === "error_apex") return /** @type {LocalizedString} */ (`Use a subdomain, such as status.example.com: a CNAME can't point the domain itself here.`);
		if (i?.part === "error_in_progress") return /** @type {LocalizedString} */ (`That domain is still being set up or cleaned up. Try again in a few minutes.`);
		if (i?.part === "error_unavailable") return /** @type {LocalizedString} */ (`Brigade couldn't save the domain right now. Try again in a minute.`);
		if (i?.part === "reason_dns") return /** @type {LocalizedString} */ (`Cloudflare can't see the DNS records yet. Check they match the ones below; new records can take a while to show.`);
		if (i?.part === "reason_caa") return /** @type {LocalizedString} */ (`A CAA record on the domain doesn't allow Cloudflare's certificate authorities. Allow them, then check again.`);
		if (i?.part === "reason_timed_out") return /** @type {LocalizedString} */ (`Cloudflare stopped waiting for the records. Check them, then remove the domain and add it again.`);
		if (i?.part === "reason_expired") return /** @type {LocalizedString} */ (`The domain's certificate expired. Check the records are still in place, then check again.`);
		if (i?.part === "reason_moved") return /** @type {LocalizedString} */ (`The domain no longer points at this Brigade instance. Put the CNAME back, then check again.`);
		if (i?.part === "reason_blocked") return /** @type {LocalizedString} */ (`Cloudflare blocked this domain. Remove it, or use another one.`);
		if (i?.part === "reason_deleted") return /** @type {LocalizedString} */ (`Cloudflare no longer has this domain. Remove it and add it again.`);
		if (i?.part === "reason_other") return /** @type {LocalizedString} */ (`Cloudflare couldn't verify the domain. Check the records, then check again.`);
		if (i?.part === "error_failed") return /** @type {LocalizedString} */ (`Couldn't save. Try again.`);
		return /** @type {LocalizedString} */ (`Custom domain`)
	}
});