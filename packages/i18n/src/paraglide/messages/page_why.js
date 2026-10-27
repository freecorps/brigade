/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, detail: NonNullable<unknown> }} Page_WhyInputs */



/**
* | text | output |
* | --- | --- |
* | "title" | "Who was paged" |
* | "why_title" | "Paging for {name}" |
* | "why_title_you" | "My paging" |
* | "why_link" | "Why?" |
* | "explain" | "Explain step by step" |
* | "back" | "Back to {name}" |
* | "pick_member" | "Member" |
* | "loading" | "Loading delivery details…" |
* | "empty" | "No page has gone out for this incident yet." |
* | "privacy" | "Everyone in this workspace sees each member's phones, when Brigade last heard from them, and when a phone received a page." |
* | "verdict_delivered" | "The page reached {name}'s phone" |
* | "verdict_accepted" | "Sent to {name}'s phone, but the phone hasn't confirmed it" |
* | "verdict_sending" | "A page is on its way to {name}" |
* | "verdict_failed" | "No page got through to {name}'s phone" |
* | "verdict_missed" | "Brigade couldn't page {name}" |
* | "verdict_declarer" | "{name} declared it, so Brigade didn't page them" |
* | "verdict_excluded" | "{name} can't be paged" |
* | "verdict_not_targeted" | "The pages went to others, not {name}" |
* | "verdict_none" | "Nothing has paged yet" |
* | "short_delivered" | "Delivered" |
* | "short_accepted" | "Sent, no receipt" |
* | "short_sending" | "Sending" |
* | "short_failed" | "Failed" |
* | "short_missed" | "Couldn't page" |
* | "short_declarer" | "Declared it" |
* | "short_excluded" | "Can't be paged" |
* | "short_not_targeted" | "Not paged" |
* | "short_none" | "Not paged yet" |
* | "step_responder" | "{name} can respond, so pages can reach them." |
* | "step_viewer" | "{name} is a viewer. Viewers only read and are never paged." |
* | "step_gone" | "{name} is no longer in this workspace." |
* | "rule_policy" | "Pages follow the escalation policy {detail}." |
* | "rule_interim" | "No escalation policy: pages go to the commander, or to everyone who can respond." |
* | "page_level" | "Level {detail}" |
* | "page_round" | "Round {detail}" |
* | "page_everyone" | "Everyone who can respond" |
* | "page_interim" | "Page" |
* | "page_again" | "Paged again" |
* | "targeted_paged" | "This page was for {name}." |
* | "targeted_declarer" | "{name} declared it: counted as reached, not pushed." |
* | "targeted_not_on_call" | "{name} wasn't on call for {detail}." |
* | "targeted_not_on_call_plain" | "{name} wasn't on call." |
* | "targeted_instead" | "Paged instead: {detail}." |
* | "targeted_not_in_level" | "This level doesn't include {name}." |
* | "targeted_excluded" | "{name} couldn't respond then (a viewer, or not a member)." |
* | "targeted_commander_only" | "The commander was paged first, not {name}." |
* | "devices_none" | "No phone registered. Signing in on the Brigade app registers one." |
* | "devices_title" | "Phones registered now" |
* | "platform_ios" | "iPhone" |
* | "platform_android" | "Android" |
* | "env_production" | "App Store build" |
* | "env_sandbox" | "Development build" |
* | "seen" | "Last heard from {time}" |
* | "calls" | "Takes calls" |
* | "stage_planned" | "Planned" |
* | "stage_sent" | "Sent by Brigade" |
* | "stage_accepted" | "Accepted by Apple" |
* | "stage_delivered" | "Opened on the phone" |
* | "no_receipt" | "No receipt from the phone. Receipts are best effort: the page may still have shown." |
* | "attempts" | "Attempts: {detail}" |
* | "error_not_configured" | "Push notifications aren't set up on this server" |
* | "error_unsupported" | "Brigade can't push to Android phones yet" |
* | "error_seal_failed" | "The page couldn't be encrypted for this phone" |
* | "error_relay_unreachable" | "Brigade's sending service didn't answer" |
* | "error_relay_refused" | "Brigade's sending service refused the request" |
* | "error_token_invalid" | "Apple said this phone's token is no longer valid, so the phone was removed" |
* | "error_apns_refused" | "Apple refused the push" |
* | "error_apns_unavailable" | "Apple was busy or failing" |
* | "apns_reason" | "Apple said: {detail}" |
* | "email_expected" | "Brigade will email {name} once about a page that missed them." |
* | "email_failed" | "Couldn't email {name} about the missed page." |
* | "email_capped" | "Not emailed: the limit on Brigade's emails was reached." |
* | "email_off" | "Emails about missed pages are off in this workspace." |
* | "acknowledged" | "{name} acknowledged it {time}, which stopped paging." |
* | "why_link_label" | "Was {name} paged?" |
* | "verdict_missed_reason" | "Brigade couldn't page {name}: {detail}" |
* | "verdict_stuck" | "A page to {name} was planned but never sent" |
* | "short_stuck" | "Planned but never sent" |
* | "stage_none" | "Not reached" |
* | "stage_stopped" | "Stopped here" |
* | "stuck_note" | "Brigade planned this page but never sent it. Pages go out within seconds, so it's stuck." |
* | "pages_same" | "Same outcome as {detail} earlier pages to this level" |
* | "pages_same_one" | "Same outcome as the earlier page to this level" |
* | "pages_show_all" | "Show all {detail} pages" |
* | "miss_no_devices" | "no phone registered" |
* | "miss_undelivered" | "the page didn't go through" |
* | "miss_token_invalid" | "Apple refused this phone's token, so it was removed. Opening the Brigade app registers it again" |
* | "miss_unsupported" | "Brigade can't page Android phones yet" |
* | "miss_not_configured" | "notifications aren't set up on this server" |
* | "miss_over_limit" | "the page went to too many phones" |
* | "miss_dead_lettered" | "the page was lost on the way" |
* | "miss_nobody_on_call" | "nobody was on call" |
* | "miss_schedule_missing" | "the level's schedule was deleted" |
* | "miss_not_a_member" | "they can no longer respond" |
* | "miss_escalation_stalled" | "the escalation stalled" |
* | "miss_nobody_else" | "nobody else could respond" |
* | * | "Who was paged" |
*
* @param {Page_WhyInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const page_why = /** @type {((inputs: Page_WhyInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_WhyInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Quem foi acionado`);
		if (i?.text === "why_title") return /** @type {LocalizedString} */ (`Acionamentos de ${i?.name}`);
		if (i?.text === "why_title_you") return /** @type {LocalizedString} */ (`Meus acionamentos`);
		if (i?.text === "why_link") return /** @type {LocalizedString} */ (`Por quê?`);
		if (i?.text === "explain") return /** @type {LocalizedString} */ (`Explicar passo a passo`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Voltar para ${i?.name}`);
		if (i?.text === "pick_member") return /** @type {LocalizedString} */ (`Membro`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Carregando detalhes da entrega…`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`Nenhum acionamento saiu para este incidente ainda.`);
		if (i?.text === "privacy") return /** @type {LocalizedString} */ (`Todos neste espaço de trabalho veem os celulares de cada membro, quando o Brigade teve sinal deles pela última vez e quando um celular recebeu um acionamento.`);
		if (i?.text === "verdict_delivered") return /** @type {LocalizedString} */ (`O acionamento chegou ao celular de ${i?.name}`);
		if (i?.text === "verdict_accepted") return /** @type {LocalizedString} */ (`Enviado ao celular de ${i?.name}, mas o celular ainda não confirmou`);
		if (i?.text === "verdict_sending") return /** @type {LocalizedString} */ (`Um acionamento está a caminho de ${i?.name}`);
		if (i?.text === "verdict_failed") return /** @type {LocalizedString} */ (`Nenhum acionamento chegou ao celular de ${i?.name}`);
		if (i?.text === "verdict_missed") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acionar ${i?.name}`);
		if (i?.text === "verdict_declarer") return /** @type {LocalizedString} */ (`Foi ${i?.name} quem declarou, então o Brigade não acionou essa pessoa`);
		if (i?.text === "verdict_excluded") return /** @type {LocalizedString} */ (`Não é possível acionar ${i?.name}`);
		if (i?.text === "verdict_not_targeted") return /** @type {LocalizedString} */ (`Os acionamentos foram para outras pessoas, não para ${i?.name}`);
		if (i?.text === "verdict_none") return /** @type {LocalizedString} */ (`Nada foi acionado ainda`);
		if (i?.text === "short_delivered") return /** @type {LocalizedString} */ (`Entregue`);
		if (i?.text === "short_accepted") return /** @type {LocalizedString} */ (`Enviado, sem confirmação`);
		if (i?.text === "short_sending") return /** @type {LocalizedString} */ (`Enviando`);
		if (i?.text === "short_failed") return /** @type {LocalizedString} */ (`Falhou`);
		if (i?.text === "short_missed") return /** @type {LocalizedString} */ (`Não foi possível acionar`);
		if (i?.text === "short_declarer") return /** @type {LocalizedString} */ (`Declarou`);
		if (i?.text === "short_excluded") return /** @type {LocalizedString} */ (`Não acionável`);
		if (i?.text === "short_not_targeted") return /** @type {LocalizedString} */ (`Não acionado`);
		if (i?.text === "short_none") return /** @type {LocalizedString} */ (`Ainda não acionado`);
		if (i?.text === "step_responder") return /** @type {LocalizedString} */ (`${i?.name} pode responder, então os acionamentos podem chegar.`);
		if (i?.text === "step_viewer") return /** @type {LocalizedString} */ (`${i?.name} só visualiza. Quem só visualiza nunca é acionado.`);
		if (i?.text === "step_gone") return /** @type {LocalizedString} */ (`${i?.name} não está mais neste espaço de trabalho.`);
		if (i?.text === "rule_policy") return /** @type {LocalizedString} */ (`Os acionamentos seguem a política de escalonamento ${i?.detail}.`);
		if (i?.text === "rule_interim") return /** @type {LocalizedString} */ (`Sem política de escalonamento: os acionamentos vão para o comandante, ou para todos que podem responder.`);
		if (i?.text === "page_level") return /** @type {LocalizedString} */ (`Nível ${i?.detail}`);
		if (i?.text === "page_round") return /** @type {LocalizedString} */ (`Rodada ${i?.detail}`);
		if (i?.text === "page_everyone") return /** @type {LocalizedString} */ (`Todos que podem responder`);
		if (i?.text === "page_interim") return /** @type {LocalizedString} */ (`Acionamento`);
		if (i?.text === "page_again") return /** @type {LocalizedString} */ (`Acionado de novo`);
		if (i?.text === "targeted_paged") return /** @type {LocalizedString} */ (`Este acionamento era para ${i?.name}.`);
		if (i?.text === "targeted_declarer") return /** @type {LocalizedString} */ (`${i?.name} declarou: conta como avisado, sem notificação.`);
		if (i?.text === "targeted_not_on_call") return /** @type {LocalizedString} */ (`${i?.name} não estava de plantão em ${i?.detail}.`);
		if (i?.text === "targeted_not_on_call_plain") return /** @type {LocalizedString} */ (`${i?.name} não estava de plantão.`);
		if (i?.text === "targeted_instead") return /** @type {LocalizedString} */ (`Acionado no lugar: ${i?.detail}.`);
		if (i?.text === "targeted_not_in_level") return /** @type {LocalizedString} */ (`Este nível não inclui ${i?.name}.`);
		if (i?.text === "targeted_excluded") return /** @type {LocalizedString} */ (`${i?.name} não podia responder na hora (só visualiza, ou não era membro).`);
		if (i?.text === "targeted_commander_only") return /** @type {LocalizedString} */ (`O comandante foi acionado primeiro, não ${i?.name}.`);
		if (i?.text === "devices_none") return /** @type {LocalizedString} */ (`Nenhum celular registrado. Entrar no app do Brigade registra um.`);
		if (i?.text === "devices_title") return /** @type {LocalizedString} */ (`Celulares registrados agora`);
		if (i?.text === "platform_ios") return /** @type {LocalizedString} */ (`iPhone`);
		if (i?.text === "platform_android") return /** @type {LocalizedString} */ (`Android`);
		if (i?.text === "env_production") return /** @type {LocalizedString} */ (`Build da App Store`);
		if (i?.text === "env_sandbox") return /** @type {LocalizedString} */ (`Build de desenvolvimento`);
		if (i?.text === "seen") return /** @type {LocalizedString} */ (`Último sinal ${i?.time}`);
		if (i?.text === "calls") return /** @type {LocalizedString} */ (`Recebe chamadas`);
		if (i?.text === "stage_planned") return /** @type {LocalizedString} */ (`Planejado`);
		if (i?.text === "stage_sent") return /** @type {LocalizedString} */ (`Enviado pelo Brigade`);
		if (i?.text === "stage_accepted") return /** @type {LocalizedString} */ (`Aceito pela Apple`);
		if (i?.text === "stage_delivered") return /** @type {LocalizedString} */ (`Aberto no celular`);
		if (i?.text === "no_receipt") return /** @type {LocalizedString} */ (`O celular não confirmou. A confirmação é feita sem garantia: o acionamento pode ter aparecido mesmo assim.`);
		if (i?.text === "attempts") return /** @type {LocalizedString} */ (`Tentativas: ${i?.detail}`);
		if (i?.text === "error_not_configured") return /** @type {LocalizedString} */ (`As notificações não estão configuradas neste servidor`);
		if (i?.text === "error_unsupported") return /** @type {LocalizedString} */ (`O Brigade ainda não aciona celulares Android`);
		if (i?.text === "error_seal_failed") return /** @type {LocalizedString} */ (`Não foi possível criptografar o acionamento para este celular`);
		if (i?.text === "error_relay_unreachable") return /** @type {LocalizedString} */ (`O serviço de envio do Brigade não respondeu`);
		if (i?.text === "error_relay_refused") return /** @type {LocalizedString} */ (`O serviço de envio do Brigade recusou o pedido`);
		if (i?.text === "error_token_invalid") return /** @type {LocalizedString} */ (`A Apple disse que o token deste celular não vale mais, então o celular foi removido`);
		if (i?.text === "error_apns_refused") return /** @type {LocalizedString} */ (`A Apple recusou a notificação`);
		if (i?.text === "error_apns_unavailable") return /** @type {LocalizedString} */ (`A Apple estava ocupada ou falhando`);
		if (i?.text === "apns_reason") return /** @type {LocalizedString} */ (`A Apple disse: ${i?.detail}`);
		if (i?.text === "email_expected") return /** @type {LocalizedString} */ (`O Brigade vai enviar um email a ${i?.name}, uma vez, sobre um acionamento que não chegou.`);
		if (i?.text === "email_failed") return /** @type {LocalizedString} */ (`Não foi possível enviar o email a ${i?.name} sobre o acionamento perdido.`);
		if (i?.text === "email_capped") return /** @type {LocalizedString} */ (`Sem email: o limite de emails do Brigade foi atingido.`);
		if (i?.text === "email_off") return /** @type {LocalizedString} */ (`Os emails sobre acionamentos perdidos estão desligados neste espaço de trabalho.`);
		if (i?.text === "acknowledged") return /** @type {LocalizedString} */ (`${i?.name} reconheceu ${i?.time}, o que parou os acionamentos.`);
		if (i?.text === "why_link_label") return /** @type {LocalizedString} */ (`Ver acionamentos de ${i?.name}`);
		if (i?.text === "verdict_missed_reason") return /** @type {LocalizedString} */ (`O Brigade não conseguiu acionar ${i?.name}: ${i?.detail}`);
		if (i?.text === "verdict_stuck") return /** @type {LocalizedString} */ (`Um acionamento para ${i?.name} foi planejado, mas nunca enviado`);
		if (i?.text === "short_stuck") return /** @type {LocalizedString} */ (`Planejado, nunca enviado`);
		if (i?.text === "stage_none") return /** @type {LocalizedString} */ (`Não chegou aqui`);
		if (i?.text === "stage_stopped") return /** @type {LocalizedString} */ (`Parou aqui`);
		if (i?.text === "stuck_note") return /** @type {LocalizedString} */ (`O Brigade planejou este acionamento, mas nunca o enviou. Acionamentos saem em segundos, então ele travou.`);
		if (i?.text === "pages_same") return /** @type {LocalizedString} */ (`Mesmo resultado dos ${i?.detail} acionamentos anteriores deste nível`);
		if (i?.text === "pages_same_one") return /** @type {LocalizedString} */ (`Mesmo resultado do acionamento anterior deste nível`);
		if (i?.text === "pages_show_all") return /** @type {LocalizedString} */ (`Mostrar todos os ${i?.detail} acionamentos`);
		if (i?.text === "miss_no_devices") return /** @type {LocalizedString} */ (`nenhum celular registrado`);
		if (i?.text === "miss_undelivered") return /** @type {LocalizedString} */ (`o acionamento não foi entregue`);
		if (i?.text === "miss_token_invalid") return /** @type {LocalizedString} */ (`a Apple recusou o token deste celular, então ele foi removido. Abrir o app do Brigade registra o celular de novo`);
		if (i?.text === "miss_unsupported") return /** @type {LocalizedString} */ (`o Brigade ainda não aciona celulares Android`);
		if (i?.text === "miss_not_configured") return /** @type {LocalizedString} */ (`as notificações não estão configuradas neste servidor`);
		if (i?.text === "miss_over_limit") return /** @type {LocalizedString} */ (`o acionamento foi para celulares demais`);
		if (i?.text === "miss_dead_lettered") return /** @type {LocalizedString} */ (`o acionamento se perdeu no caminho`);
		if (i?.text === "miss_nobody_on_call") return /** @type {LocalizedString} */ (`ninguém estava de plantão`);
		if (i?.text === "miss_schedule_missing") return /** @type {LocalizedString} */ (`a escala do nível foi apagada`);
		if (i?.text === "miss_not_a_member") return /** @type {LocalizedString} */ (`não pode mais responder`);
		if (i?.text === "miss_escalation_stalled") return /** @type {LocalizedString} */ (`o escalonamento travou`);
		if (i?.text === "miss_nobody_else") return /** @type {LocalizedString} */ (`ninguém mais podia responder`);
		return /** @type {LocalizedString} */ (`Quem foi acionado`)
	}
	{
		if (i?.text === "title") return /** @type {LocalizedString} */ (`Who was paged`);
		if (i?.text === "why_title") return /** @type {LocalizedString} */ (`Paging for ${i?.name}`);
		if (i?.text === "why_title_you") return /** @type {LocalizedString} */ (`My paging`);
		if (i?.text === "why_link") return /** @type {LocalizedString} */ (`Why?`);
		if (i?.text === "explain") return /** @type {LocalizedString} */ (`Explain step by step`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Back to ${i?.name}`);
		if (i?.text === "pick_member") return /** @type {LocalizedString} */ (`Member`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Loading delivery details…`);
		if (i?.text === "empty") return /** @type {LocalizedString} */ (`No page has gone out for this incident yet.`);
		if (i?.text === "privacy") return /** @type {LocalizedString} */ (`Everyone in this workspace sees each member's phones, when Brigade last heard from them, and when a phone received a page.`);
		if (i?.text === "verdict_delivered") return /** @type {LocalizedString} */ (`The page reached ${i?.name}'s phone`);
		if (i?.text === "verdict_accepted") return /** @type {LocalizedString} */ (`Sent to ${i?.name}'s phone, but the phone hasn't confirmed it`);
		if (i?.text === "verdict_sending") return /** @type {LocalizedString} */ (`A page is on its way to ${i?.name}`);
		if (i?.text === "verdict_failed") return /** @type {LocalizedString} */ (`No page got through to ${i?.name}'s phone`);
		if (i?.text === "verdict_missed") return /** @type {LocalizedString} */ (`Brigade couldn't page ${i?.name}`);
		if (i?.text === "verdict_declarer") return /** @type {LocalizedString} */ (`${i?.name} declared it, so Brigade didn't page them`);
		if (i?.text === "verdict_excluded") return /** @type {LocalizedString} */ (`${i?.name} can't be paged`);
		if (i?.text === "verdict_not_targeted") return /** @type {LocalizedString} */ (`The pages went to others, not ${i?.name}`);
		if (i?.text === "verdict_none") return /** @type {LocalizedString} */ (`Nothing has paged yet`);
		if (i?.text === "short_delivered") return /** @type {LocalizedString} */ (`Delivered`);
		if (i?.text === "short_accepted") return /** @type {LocalizedString} */ (`Sent, no receipt`);
		if (i?.text === "short_sending") return /** @type {LocalizedString} */ (`Sending`);
		if (i?.text === "short_failed") return /** @type {LocalizedString} */ (`Failed`);
		if (i?.text === "short_missed") return /** @type {LocalizedString} */ (`Couldn't page`);
		if (i?.text === "short_declarer") return /** @type {LocalizedString} */ (`Declared it`);
		if (i?.text === "short_excluded") return /** @type {LocalizedString} */ (`Can't be paged`);
		if (i?.text === "short_not_targeted") return /** @type {LocalizedString} */ (`Not paged`);
		if (i?.text === "short_none") return /** @type {LocalizedString} */ (`Not paged yet`);
		if (i?.text === "step_responder") return /** @type {LocalizedString} */ (`${i?.name} can respond, so pages can reach them.`);
		if (i?.text === "step_viewer") return /** @type {LocalizedString} */ (`${i?.name} is a viewer. Viewers only read and are never paged.`);
		if (i?.text === "step_gone") return /** @type {LocalizedString} */ (`${i?.name} is no longer in this workspace.`);
		if (i?.text === "rule_policy") return /** @type {LocalizedString} */ (`Pages follow the escalation policy ${i?.detail}.`);
		if (i?.text === "rule_interim") return /** @type {LocalizedString} */ (`No escalation policy: pages go to the commander, or to everyone who can respond.`);
		if (i?.text === "page_level") return /** @type {LocalizedString} */ (`Level ${i?.detail}`);
		if (i?.text === "page_round") return /** @type {LocalizedString} */ (`Round ${i?.detail}`);
		if (i?.text === "page_everyone") return /** @type {LocalizedString} */ (`Everyone who can respond`);
		if (i?.text === "page_interim") return /** @type {LocalizedString} */ (`Page`);
		if (i?.text === "page_again") return /** @type {LocalizedString} */ (`Paged again`);
		if (i?.text === "targeted_paged") return /** @type {LocalizedString} */ (`This page was for ${i?.name}.`);
		if (i?.text === "targeted_declarer") return /** @type {LocalizedString} */ (`${i?.name} declared it: counted as reached, not pushed.`);
		if (i?.text === "targeted_not_on_call") return /** @type {LocalizedString} */ (`${i?.name} wasn't on call for ${i?.detail}.`);
		if (i?.text === "targeted_not_on_call_plain") return /** @type {LocalizedString} */ (`${i?.name} wasn't on call.`);
		if (i?.text === "targeted_instead") return /** @type {LocalizedString} */ (`Paged instead: ${i?.detail}.`);
		if (i?.text === "targeted_not_in_level") return /** @type {LocalizedString} */ (`This level doesn't include ${i?.name}.`);
		if (i?.text === "targeted_excluded") return /** @type {LocalizedString} */ (`${i?.name} couldn't respond then (a viewer, or not a member).`);
		if (i?.text === "targeted_commander_only") return /** @type {LocalizedString} */ (`The commander was paged first, not ${i?.name}.`);
		if (i?.text === "devices_none") return /** @type {LocalizedString} */ (`No phone registered. Signing in on the Brigade app registers one.`);
		if (i?.text === "devices_title") return /** @type {LocalizedString} */ (`Phones registered now`);
		if (i?.text === "platform_ios") return /** @type {LocalizedString} */ (`iPhone`);
		if (i?.text === "platform_android") return /** @type {LocalizedString} */ (`Android`);
		if (i?.text === "env_production") return /** @type {LocalizedString} */ (`App Store build`);
		if (i?.text === "env_sandbox") return /** @type {LocalizedString} */ (`Development build`);
		if (i?.text === "seen") return /** @type {LocalizedString} */ (`Last heard from ${i?.time}`);
		if (i?.text === "calls") return /** @type {LocalizedString} */ (`Takes calls`);
		if (i?.text === "stage_planned") return /** @type {LocalizedString} */ (`Planned`);
		if (i?.text === "stage_sent") return /** @type {LocalizedString} */ (`Sent by Brigade`);
		if (i?.text === "stage_accepted") return /** @type {LocalizedString} */ (`Accepted by Apple`);
		if (i?.text === "stage_delivered") return /** @type {LocalizedString} */ (`Opened on the phone`);
		if (i?.text === "no_receipt") return /** @type {LocalizedString} */ (`No receipt from the phone. Receipts are best effort: the page may still have shown.`);
		if (i?.text === "attempts") return /** @type {LocalizedString} */ (`Attempts: ${i?.detail}`);
		if (i?.text === "error_not_configured") return /** @type {LocalizedString} */ (`Push notifications aren't set up on this server`);
		if (i?.text === "error_unsupported") return /** @type {LocalizedString} */ (`Brigade can't push to Android phones yet`);
		if (i?.text === "error_seal_failed") return /** @type {LocalizedString} */ (`The page couldn't be encrypted for this phone`);
		if (i?.text === "error_relay_unreachable") return /** @type {LocalizedString} */ (`Brigade's sending service didn't answer`);
		if (i?.text === "error_relay_refused") return /** @type {LocalizedString} */ (`Brigade's sending service refused the request`);
		if (i?.text === "error_token_invalid") return /** @type {LocalizedString} */ (`Apple said this phone's token is no longer valid, so the phone was removed`);
		if (i?.text === "error_apns_refused") return /** @type {LocalizedString} */ (`Apple refused the push`);
		if (i?.text === "error_apns_unavailable") return /** @type {LocalizedString} */ (`Apple was busy or failing`);
		if (i?.text === "apns_reason") return /** @type {LocalizedString} */ (`Apple said: ${i?.detail}`);
		if (i?.text === "email_expected") return /** @type {LocalizedString} */ (`Brigade will email ${i?.name} once about a page that missed them.`);
		if (i?.text === "email_failed") return /** @type {LocalizedString} */ (`Couldn't email ${i?.name} about the missed page.`);
		if (i?.text === "email_capped") return /** @type {LocalizedString} */ (`Not emailed: the limit on Brigade's emails was reached.`);
		if (i?.text === "email_off") return /** @type {LocalizedString} */ (`Emails about missed pages are off in this workspace.`);
		if (i?.text === "acknowledged") return /** @type {LocalizedString} */ (`${i?.name} acknowledged it ${i?.time}, which stopped paging.`);
		if (i?.text === "why_link_label") return /** @type {LocalizedString} */ (`Was ${i?.name} paged?`);
		if (i?.text === "verdict_missed_reason") return /** @type {LocalizedString} */ (`Brigade couldn't page ${i?.name}: ${i?.detail}`);
		if (i?.text === "verdict_stuck") return /** @type {LocalizedString} */ (`A page to ${i?.name} was planned but never sent`);
		if (i?.text === "short_stuck") return /** @type {LocalizedString} */ (`Planned but never sent`);
		if (i?.text === "stage_none") return /** @type {LocalizedString} */ (`Not reached`);
		if (i?.text === "stage_stopped") return /** @type {LocalizedString} */ (`Stopped here`);
		if (i?.text === "stuck_note") return /** @type {LocalizedString} */ (`Brigade planned this page but never sent it. Pages go out within seconds, so it's stuck.`);
		if (i?.text === "pages_same") return /** @type {LocalizedString} */ (`Same outcome as ${i?.detail} earlier pages to this level`);
		if (i?.text === "pages_same_one") return /** @type {LocalizedString} */ (`Same outcome as the earlier page to this level`);
		if (i?.text === "pages_show_all") return /** @type {LocalizedString} */ (`Show all ${i?.detail} pages`);
		if (i?.text === "miss_no_devices") return /** @type {LocalizedString} */ (`no phone registered`);
		if (i?.text === "miss_undelivered") return /** @type {LocalizedString} */ (`the page didn't go through`);
		if (i?.text === "miss_token_invalid") return /** @type {LocalizedString} */ (`Apple refused this phone's token, so it was removed. Opening the Brigade app registers it again`);
		if (i?.text === "miss_unsupported") return /** @type {LocalizedString} */ (`Brigade can't page Android phones yet`);
		if (i?.text === "miss_not_configured") return /** @type {LocalizedString} */ (`notifications aren't set up on this server`);
		if (i?.text === "miss_over_limit") return /** @type {LocalizedString} */ (`the page went to too many phones`);
		if (i?.text === "miss_dead_lettered") return /** @type {LocalizedString} */ (`the page was lost on the way`);
		if (i?.text === "miss_nobody_on_call") return /** @type {LocalizedString} */ (`nobody was on call`);
		if (i?.text === "miss_schedule_missing") return /** @type {LocalizedString} */ (`the level's schedule was deleted`);
		if (i?.text === "miss_not_a_member") return /** @type {LocalizedString} */ (`they can no longer respond`);
		if (i?.text === "miss_escalation_stalled") return /** @type {LocalizedString} */ (`the escalation stalled`);
		if (i?.text === "miss_nobody_else") return /** @type {LocalizedString} */ (`nobody else could respond`);
		return /** @type {LocalizedString} */ (`Who was paged`)
	}
});