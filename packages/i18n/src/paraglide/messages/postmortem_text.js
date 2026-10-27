/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, time: NonNullable<unknown>, count: NonNullable<unknown>, reason: NonNullable<unknown> }} Postmortem_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Postmortem" |
* | "description" | "What happened and what the team learned, section by section. Plain text." |
* | "empty" | "No postmortem yet." |
* | "start" | "Write postmortem" |
* | "edit" | "Edit" |
* | "save" | "Save" |
* | "cancel" | "Cancel" |
* | "saving" | "Saving…" |
* | "section_summary" | "Summary" |
* | "section_impact" | "Impact" |
* | "section_timeline" | "Timeline" |
* | "section_rootCause" | "Root cause" |
* | "section_wentWell" | "What went well" |
* | "section_wentPoorly" | "What went poorly" |
* | "section_followUps" | "Follow-ups" |
* | "section_empty" | "Not written yet." |
* | "updated" | "Revision {count}, saved {time} by {name}" |
* | "conflict" | "Someone saved the postmortem while you were editing. Your text is still here: copy what you need, then reload their version." |
* | "reload" | "Load the latest version" |
* | "save_failed" | "Couldn't save the postmortem: {reason}" |
* | "ai_draft" | "Draft with AI" |
* | "ai_redraft" | "Draft again with AI" |
* | "ai_hint" | "Workers AI writes a first draft from the timeline, updates and follow-ups. Nobody's email or devices are sent." |
* | "ai_pending" | "Writing a draft…" |
* | "ai_marker" | "AI draft — review before sharing" |
* | "ai_marker_hint" | "Written by Workers AI from the timeline. Check every section; saving marks it as reviewed." |
* | "ai_failed_failed" | "The AI draft failed. Try again in a moment." |
* | "ai_failed_timeout" | "The AI draft took too long. Try again." |
* | "ai_failed_edited" | "Someone saved the postmortem while the AI was writing, so their text was kept." |
* | "ai_failed_unavailable" | "AI drafts aren't available right now." |
* | "ai_refused_limit_reached" | "This workspace asked for as many AI drafts as it can today. Try again tomorrow." |
* | "ai_refused_conflict" | "A draft is already being written, or the postmortem has text a member wrote." |
* | "ai_refused_ai_unavailable" | "AI drafts aren't set up on this server." |
* | "ai_refused_other" | "Couldn't ask for a draft: {reason}" |
* | "chars" | "{count} left" |
* | "read_only" | "Only responders, admins and owners edit the postmortem." |
* | * | "Postmortem" |
*
* @param {Postmortem_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const postmortem_text = /** @type {((inputs: Postmortem_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Postmortem_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Postmortem`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`O que aconteceu e o que o time aprendeu, seção por seção. Texto simples.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`Nenhum postmortem ainda.`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`Escrever postmortem`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "section_summary") return /** @type {LocalizedString} */ (`Resumo`);
		if (i?.part === "section_impact") return /** @type {LocalizedString} */ (`Impacto`);
		if (i?.part === "section_timeline") return /** @type {LocalizedString} */ (`Linha do tempo`);
		if (i?.part === "section_rootCause") return /** @type {LocalizedString} */ (`Causa raiz`);
		if (i?.part === "section_wentWell") return /** @type {LocalizedString} */ (`O que deu certo`);
		if (i?.part === "section_wentPoorly") return /** @type {LocalizedString} */ (`O que deu errado`);
		if (i?.part === "section_followUps") return /** @type {LocalizedString} */ (`Ações de acompanhamento`);
		if (i?.part === "section_empty") return /** @type {LocalizedString} */ (`Ainda não escrito.`);
		if (i?.part === "updated") return /** @type {LocalizedString} */ (`Revisão ${i?.count}, salva ${i?.time} por ${i?.name}`);
		if (i?.part === "conflict") return /** @type {LocalizedString} */ (`Alguém salvou o postmortem enquanto você editava. Seu texto continua aqui: copie o que precisar e carregue a versão dessa pessoa.`);
		if (i?.part === "reload") return /** @type {LocalizedString} */ (`Carregar a versão mais recente`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar o postmortem: ${i?.reason}`);
		if (i?.part === "ai_draft") return /** @type {LocalizedString} */ (`Rascunho com IA`);
		if (i?.part === "ai_redraft") return /** @type {LocalizedString} */ (`Novo rascunho com IA`);
		if (i?.part === "ai_hint") return /** @type {LocalizedString} */ (`O Workers AI escreve um primeiro rascunho a partir da linha do tempo, das atualizações e das ações. Nenhum e-mail ou dispositivo é enviado.`);
		if (i?.part === "ai_pending") return /** @type {LocalizedString} */ (`Escrevendo um rascunho…`);
		if (i?.part === "ai_marker") return /** @type {LocalizedString} */ (`Rascunho de IA — revise antes de compartilhar`);
		if (i?.part === "ai_marker_hint") return /** @type {LocalizedString} */ (`Escrito pelo Workers AI a partir da linha do tempo. Confira cada seção; salvar marca como revisado.`);
		if (i?.part === "ai_failed_failed") return /** @type {LocalizedString} */ (`O rascunho de IA falhou. Tente de novo daqui a pouco.`);
		if (i?.part === "ai_failed_timeout") return /** @type {LocalizedString} */ (`O rascunho de IA demorou demais. Tente de novo.`);
		if (i?.part === "ai_failed_edited") return /** @type {LocalizedString} */ (`Alguém salvou o postmortem enquanto a IA escrevia, então o texto dessa pessoa foi mantido.`);
		if (i?.part === "ai_failed_unavailable") return /** @type {LocalizedString} */ (`Os rascunhos de IA não estão disponíveis agora.`);
		if (i?.part === "ai_refused_limit_reached") return /** @type {LocalizedString} */ (`Este workspace já pediu o máximo de rascunhos de IA hoje. Tente amanhã.`);
		if (i?.part === "ai_refused_conflict") return /** @type {LocalizedString} */ (`Um rascunho já está sendo escrito, ou o postmortem tem texto escrito por um membro.`);
		if (i?.part === "ai_refused_ai_unavailable") return /** @type {LocalizedString} */ (`Os rascunhos de IA não estão configurados neste servidor.`);
		if (i?.part === "ai_refused_other") return /** @type {LocalizedString} */ (`Não foi possível pedir um rascunho: ${i?.reason}`);
		if (i?.part === "chars") return /** @type {LocalizedString} */ (`Restam: ${i?.count}`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Só responders, admins e owners editam o postmortem.`);
		return /** @type {LocalizedString} */ (`Postmortem`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Postmortem`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`What happened and what the team learned, section by section. Plain text.`);
		if (i?.part === "empty") return /** @type {LocalizedString} */ (`No postmortem yet.`);
		if (i?.part === "start") return /** @type {LocalizedString} */ (`Write postmortem`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "section_summary") return /** @type {LocalizedString} */ (`Summary`);
		if (i?.part === "section_impact") return /** @type {LocalizedString} */ (`Impact`);
		if (i?.part === "section_timeline") return /** @type {LocalizedString} */ (`Timeline`);
		if (i?.part === "section_rootCause") return /** @type {LocalizedString} */ (`Root cause`);
		if (i?.part === "section_wentWell") return /** @type {LocalizedString} */ (`What went well`);
		if (i?.part === "section_wentPoorly") return /** @type {LocalizedString} */ (`What went poorly`);
		if (i?.part === "section_followUps") return /** @type {LocalizedString} */ (`Follow-ups`);
		if (i?.part === "section_empty") return /** @type {LocalizedString} */ (`Not written yet.`);
		if (i?.part === "updated") return /** @type {LocalizedString} */ (`Revision ${i?.count}, saved ${i?.time} by ${i?.name}`);
		if (i?.part === "conflict") return /** @type {LocalizedString} */ (`Someone saved the postmortem while you were editing. Your text is still here: copy what you need, then reload their version.`);
		if (i?.part === "reload") return /** @type {LocalizedString} */ (`Load the latest version`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Couldn't save the postmortem: ${i?.reason}`);
		if (i?.part === "ai_draft") return /** @type {LocalizedString} */ (`Draft with AI`);
		if (i?.part === "ai_redraft") return /** @type {LocalizedString} */ (`Draft again with AI`);
		if (i?.part === "ai_hint") return /** @type {LocalizedString} */ (`Workers AI writes a first draft from the timeline, updates and follow-ups. Nobody's email or devices are sent.`);
		if (i?.part === "ai_pending") return /** @type {LocalizedString} */ (`Writing a draft…`);
		if (i?.part === "ai_marker") return /** @type {LocalizedString} */ (`AI draft — review before sharing`);
		if (i?.part === "ai_marker_hint") return /** @type {LocalizedString} */ (`Written by Workers AI from the timeline. Check every section; saving marks it as reviewed.`);
		if (i?.part === "ai_failed_failed") return /** @type {LocalizedString} */ (`The AI draft failed. Try again in a moment.`);
		if (i?.part === "ai_failed_timeout") return /** @type {LocalizedString} */ (`The AI draft took too long. Try again.`);
		if (i?.part === "ai_failed_edited") return /** @type {LocalizedString} */ (`Someone saved the postmortem while the AI was writing, so their text was kept.`);
		if (i?.part === "ai_failed_unavailable") return /** @type {LocalizedString} */ (`AI drafts aren't available right now.`);
		if (i?.part === "ai_refused_limit_reached") return /** @type {LocalizedString} */ (`This workspace asked for as many AI drafts as it can today. Try again tomorrow.`);
		if (i?.part === "ai_refused_conflict") return /** @type {LocalizedString} */ (`A draft is already being written, or the postmortem has text a member wrote.`);
		if (i?.part === "ai_refused_ai_unavailable") return /** @type {LocalizedString} */ (`AI drafts aren't set up on this server.`);
		if (i?.part === "ai_refused_other") return /** @type {LocalizedString} */ (`Couldn't ask for a draft: ${i?.reason}`);
		if (i?.part === "chars") return /** @type {LocalizedString} */ (`${i?.count} left`);
		if (i?.part === "read_only") return /** @type {LocalizedString} */ (`Only responders, admins and owners edit the postmortem.`);
		return /** @type {LocalizedString} */ (`Postmortem`)
	}
});