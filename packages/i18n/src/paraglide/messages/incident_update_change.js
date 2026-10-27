/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, time: NonNullable<unknown>, reason: NonNullable<unknown> }} Incident_Update_ChangeInputs */



/**
* | part | output |
* | --- | --- |
* | "edited" | "edited" |
* | "edited_at" | "Edited {time}" |
* | "actions" | "Update actions" |
* | "edit" | "Edit" |
* | "remove" | "Remove" |
* | "edit_label" | "Edit your update" |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "cancel" | "Cancel" |
* | "unchanged" | "The update already says that." |
* | "gone" | "This update was removed, so there's nothing to change." |
* | "edit_failed" | "Couldn't save the edit. {reason}" |
* | "remove_title" | "Remove this update?" |
* | "remove_body" | "Its text is removed for everyone, here and where Brigade mirrored it in Slack. The timeline keeps a line saying who removed it. What was published on the sta..." |
* | "remove_confirm" | "Remove update" |
* | "removing" | "Removing…" |
* | "remove_failed" | "Couldn't remove the update. {reason}" |
* | "status_page_note" | "Editing doesn't change what was published on the status page." |
* | * | "edited" |
*
* @param {Incident_Update_ChangeInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const incident_update_change = /** @type {((inputs: Incident_Update_ChangeInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Incident_Update_ChangeInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "edited") return /** @type {LocalizedString} */ (`editada`);
		if (i?.part === "edited_at") return /** @type {LocalizedString} */ (`Editada ${i?.time}`);
		if (i?.part === "actions") return /** @type {LocalizedString} */ (`Ações da atualização`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "edit_label") return /** @type {LocalizedString} */ (`Editar sua atualização`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "unchanged") return /** @type {LocalizedString} */ (`A atualização já diz isso.`);
		if (i?.part === "gone") return /** @type {LocalizedString} */ (`Esta atualização foi removida, então não há o que mudar.`);
		if (i?.part === "edit_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar a edição. ${i?.reason}`);
		if (i?.part === "remove_title") return /** @type {LocalizedString} */ (`Remover esta atualização?`);
		if (i?.part === "remove_body") return /** @type {LocalizedString} */ (`O texto é removido para todos, aqui e onde o Brigade o espelhou no Slack. A linha do tempo mantém uma linha dizendo quem removeu. O que foi publicado na página de status continua como está.`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Remover atualização`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removendo…`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Não foi possível remover a atualização. ${i?.reason}`);
		if (i?.part === "status_page_note") return /** @type {LocalizedString} */ (`Editar não muda o que foi publicado na página de status.`);
		return /** @type {LocalizedString} */ (`editada`)
	}
	{
		if (i?.part === "edited") return /** @type {LocalizedString} */ (`edited`);
		if (i?.part === "edited_at") return /** @type {LocalizedString} */ (`Edited ${i?.time}`);
		if (i?.part === "actions") return /** @type {LocalizedString} */ (`Update actions`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.part === "edit_label") return /** @type {LocalizedString} */ (`Edit your update`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "unchanged") return /** @type {LocalizedString} */ (`The update already says that.`);
		if (i?.part === "gone") return /** @type {LocalizedString} */ (`This update was removed, so there's nothing to change.`);
		if (i?.part === "edit_failed") return /** @type {LocalizedString} */ (`Couldn't save the edit. ${i?.reason}`);
		if (i?.part === "remove_title") return /** @type {LocalizedString} */ (`Remove this update?`);
		if (i?.part === "remove_body") return /** @type {LocalizedString} */ (`Its text is removed for everyone, here and where Brigade mirrored it in Slack. The timeline keeps a line saying who removed it. What was published on the status page stays as it is.`);
		if (i?.part === "remove_confirm") return /** @type {LocalizedString} */ (`Remove update`);
		if (i?.part === "removing") return /** @type {LocalizedString} */ (`Removing…`);
		if (i?.part === "remove_failed") return /** @type {LocalizedString} */ (`Couldn't remove the update. ${i?.reason}`);
		if (i?.part === "status_page_note") return /** @type {LocalizedString} */ (`Editing doesn't change what was published on the status page.`);
		return /** @type {LocalizedString} */ (`edited`)
	}
});