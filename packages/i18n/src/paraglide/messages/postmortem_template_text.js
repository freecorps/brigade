/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, name: NonNullable<unknown>, count: NonNullable<unknown> }} Postmortem_Template_TextInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Postmortem templates" |
* | "note" | "The sections a new postmortem starts with, per incident type. Once someone writes in a postmortem, it keeps its sections: editing a template or changing the ..." |
* | "default_name" | "Workspace default" |
* | "default_note" | "For incidents with no type, or a type without its own template." |
* | "builtin" | "The seven built-in sections" |
* | "uses_default" | "Uses the workspace default" |
* | "sections" | "Sections: {name}" |
* | "edit" | "Edit template" |
* | "edit_on" | "Edit the postmortem template of {name}" |
* | "form_title" | "Postmortem template: {name}" |
* | "custom" | "Custom" |
* | "custom_name" | "Custom section {count}" |
* | "field_title" | "Title" |
* | "field_title_builtin" | "Leave empty to keep “{name}”." |
* | "field_title_invalid" | "A custom section needs a title." |
* | "field_hint" | "Hint" |
* | "field_hint_note" | "Shown to whoever writes the section, and given to the AI draft." |
* | "field_starter" | "Starter text" |
* | "field_starter_note" | "A new postmortem's editor starts with it." |
* | "field_invalid" | "Remove hidden characters, or write something visible." |
* | "add" | "Add section" |
* | "add_custom" | "Custom section" |
* | "limit" | "A template holds every built-in section and up to three custom ones." |
* | "move_up" | "Move {name} up" |
* | "move_down" | "Move {name} down" |
* | "remove" | "Remove {name}" |
* | "preview" | "Preview" |
* | "preview_note" | "What a new postmortem's editor shows." |
* | "save" | "Save template" |
* | "cancel" | "Cancel" |
* | "reset_type" | "Use the workspace default" |
* | "reset_default" | "Use the built-in sections" |
* | "reset_confirm" | "Stop using this template? New postmortems take {name}. Postmortems already written keep their sections." |
* | "reset_confirm_action" | "Stop using it" |
* | "ai_title" | "AI drafts" |
* | "ai_hint" | "Members can ask Workers AI for a first draft of a blank postmortem. Off, the button is hidden and the server refuses." |
* | "ai_owner_only" | "Only owners can turn AI drafts on or off." |
* | "ai_failed" | "Couldn't change AI drafts: {name}" |
* | * | "Postmortem templates" |
*
* @param {Postmortem_Template_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const postmortem_template_text = /** @type {((inputs: Postmortem_Template_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Postmortem_Template_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Modelos de postmortem`);
		if (i?.part === "note") return /** @type {LocalizedString} */ (`As seções com que um novo postmortem começa, por tipo de incidente. Depois que alguém escreve em um postmortem, ele mantém as suas seções: editar um modelo ou mudar o tipo do incidente não o altera. Um postmortem em branco segue o novo tipo do incidente.`);
		if (i?.part === "default_name") return /** @type {LocalizedString} */ (`Padrão do workspace`);
		if (i?.part === "default_note") return /** @type {LocalizedString} */ (`Para incidentes sem tipo, ou de um tipo sem modelo próprio.`);
		if (i?.part === "builtin") return /** @type {LocalizedString} */ (`As sete seções padrão`);
		if (i?.part === "uses_default") return /** @type {LocalizedString} */ (`Usa o padrão do workspace`);
		if (i?.part === "sections") return /** @type {LocalizedString} */ (`Seções: ${i?.name}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar modelo`);
		if (i?.part === "edit_on") return /** @type {LocalizedString} */ (`Editar o modelo de postmortem de ${i?.name}`);
		if (i?.part === "form_title") return /** @type {LocalizedString} */ (`Modelo de postmortem: ${i?.name}`);
		if (i?.part === "custom") return /** @type {LocalizedString} */ (`Personalizada`);
		if (i?.part === "custom_name") return /** @type {LocalizedString} */ (`Seção personalizada ${i?.count}`);
		if (i?.part === "field_title") return /** @type {LocalizedString} */ (`Título`);
		if (i?.part === "field_title_builtin") return /** @type {LocalizedString} */ (`Deixe vazio para manter “${i?.name}”.`);
		if (i?.part === "field_title_invalid") return /** @type {LocalizedString} */ (`Uma seção personalizada precisa de um título.`);
		if (i?.part === "field_hint") return /** @type {LocalizedString} */ (`Dica`);
		if (i?.part === "field_hint_note") return /** @type {LocalizedString} */ (`Mostrada a quem escreve a seção e passada ao rascunho de IA.`);
		if (i?.part === "field_starter") return /** @type {LocalizedString} */ (`Texto inicial`);
		if (i?.part === "field_starter_note") return /** @type {LocalizedString} */ (`O editor de um novo postmortem começa com ele.`);
		if (i?.part === "field_invalid") return /** @type {LocalizedString} */ (`Remova caracteres ocultos ou escreva algo visível.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar seção`);
		if (i?.part === "add_custom") return /** @type {LocalizedString} */ (`Seção personalizada`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Um modelo tem todas as seções padrão e até três personalizadas.`);
		if (i?.part === "move_up") return /** @type {LocalizedString} */ (`Mover ${i?.name} para cima`);
		if (i?.part === "move_down") return /** @type {LocalizedString} */ (`Mover ${i?.name} para baixo`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover ${i?.name}`);
		if (i?.part === "preview") return /** @type {LocalizedString} */ (`Prévia`);
		if (i?.part === "preview_note") return /** @type {LocalizedString} */ (`O que o editor de um novo postmortem mostra.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar modelo`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "reset_type") return /** @type {LocalizedString} */ (`Usar o padrão do workspace`);
		if (i?.part === "reset_default") return /** @type {LocalizedString} */ (`Usar as seções padrão`);
		if (i?.part === "reset_confirm") return /** @type {LocalizedString} */ (`Deixar de usar este modelo? Novos postmortems passam a usar ${i?.name}. Postmortems já escritos mantêm suas seções.`);
		if (i?.part === "reset_confirm_action") return /** @type {LocalizedString} */ (`Deixar de usar`);
		if (i?.part === "ai_title") return /** @type {LocalizedString} */ (`Rascunhos de IA`);
		if (i?.part === "ai_hint") return /** @type {LocalizedString} */ (`Os membros podem pedir ao Workers AI um primeiro rascunho de um postmortem em branco. Desativado, o botão some e o servidor recusa.`);
		if (i?.part === "ai_owner_only") return /** @type {LocalizedString} */ (`Só proprietários podem ativar ou desativar os rascunhos de IA.`);
		if (i?.part === "ai_failed") return /** @type {LocalizedString} */ (`Não foi possível mudar os rascunhos de IA: ${i?.name}`);
		return /** @type {LocalizedString} */ (`Modelos de postmortem`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Postmortem templates`);
		if (i?.part === "note") return /** @type {LocalizedString} */ (`The sections a new postmortem starts with, per incident type. Once someone writes in a postmortem, it keeps its sections: editing a template or changing the incident's type leaves it as it is. A blank one follows the incident's new type.`);
		if (i?.part === "default_name") return /** @type {LocalizedString} */ (`Workspace default`);
		if (i?.part === "default_note") return /** @type {LocalizedString} */ (`For incidents with no type, or a type without its own template.`);
		if (i?.part === "builtin") return /** @type {LocalizedString} */ (`The seven built-in sections`);
		if (i?.part === "uses_default") return /** @type {LocalizedString} */ (`Uses the workspace default`);
		if (i?.part === "sections") return /** @type {LocalizedString} */ (`Sections: ${i?.name}`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit template`);
		if (i?.part === "edit_on") return /** @type {LocalizedString} */ (`Edit the postmortem template of ${i?.name}`);
		if (i?.part === "form_title") return /** @type {LocalizedString} */ (`Postmortem template: ${i?.name}`);
		if (i?.part === "custom") return /** @type {LocalizedString} */ (`Custom`);
		if (i?.part === "custom_name") return /** @type {LocalizedString} */ (`Custom section ${i?.count}`);
		if (i?.part === "field_title") return /** @type {LocalizedString} */ (`Title`);
		if (i?.part === "field_title_builtin") return /** @type {LocalizedString} */ (`Leave empty to keep “${i?.name}”.`);
		if (i?.part === "field_title_invalid") return /** @type {LocalizedString} */ (`A custom section needs a title.`);
		if (i?.part === "field_hint") return /** @type {LocalizedString} */ (`Hint`);
		if (i?.part === "field_hint_note") return /** @type {LocalizedString} */ (`Shown to whoever writes the section, and given to the AI draft.`);
		if (i?.part === "field_starter") return /** @type {LocalizedString} */ (`Starter text`);
		if (i?.part === "field_starter_note") return /** @type {LocalizedString} */ (`A new postmortem's editor starts with it.`);
		if (i?.part === "field_invalid") return /** @type {LocalizedString} */ (`Remove hidden characters, or write something visible.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add section`);
		if (i?.part === "add_custom") return /** @type {LocalizedString} */ (`Custom section`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`A template holds every built-in section and up to three custom ones.`);
		if (i?.part === "move_up") return /** @type {LocalizedString} */ (`Move ${i?.name} up`);
		if (i?.part === "move_down") return /** @type {LocalizedString} */ (`Move ${i?.name} down`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove ${i?.name}`);
		if (i?.part === "preview") return /** @type {LocalizedString} */ (`Preview`);
		if (i?.part === "preview_note") return /** @type {LocalizedString} */ (`What a new postmortem's editor shows.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save template`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "reset_type") return /** @type {LocalizedString} */ (`Use the workspace default`);
		if (i?.part === "reset_default") return /** @type {LocalizedString} */ (`Use the built-in sections`);
		if (i?.part === "reset_confirm") return /** @type {LocalizedString} */ (`Stop using this template? New postmortems take ${i?.name}. Postmortems already written keep their sections.`);
		if (i?.part === "reset_confirm_action") return /** @type {LocalizedString} */ (`Stop using it`);
		if (i?.part === "ai_title") return /** @type {LocalizedString} */ (`AI drafts`);
		if (i?.part === "ai_hint") return /** @type {LocalizedString} */ (`Members can ask Workers AI for a first draft of a blank postmortem. Off, the button is hidden and the server refuses.`);
		if (i?.part === "ai_owner_only") return /** @type {LocalizedString} */ (`Only owners can turn AI drafts on or off.`);
		if (i?.part === "ai_failed") return /** @type {LocalizedString} */ (`Couldn't change AI drafts: ${i?.name}`);
		return /** @type {LocalizedString} */ (`Postmortem templates`)
	}
});