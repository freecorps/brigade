/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ part: NonNullable<unknown>, url: NonNullable<unknown>, name: NonNullable<unknown>, status: NonNullable<unknown> }} Status_CardInputs */



/**
* | part | output |
* | --- | --- |
* | "title" | "Status page" |
* | "description" | "A public page where customers see which parts of your service work and what you tell them about incidents. Nothing from the internal timeline appears there u..." |
* | "load_failed" | "Couldn't load the status page settings." |
* | "retry" | "Try again" |
* | "manage_only" | "Only owners and admins can set up the status page or change its components." |
* | "not_set_up" | "No status page yet." |
* | "set_up" | "Set up" |
* | "title_label" | "Name shown on the page" |
* | "title_hint" | "Usually your company's or product's name." |
* | "title_required" | "The page needs a name of up to 80 characters, without invisible characters." |
* | "slug_label" | "Address" |
* | "slug_hint" | "3 to 40 lowercase letters, numbers and hyphens." |
* | "slug_invalid" | "Use 3 to 40 lowercase letters, numbers and single hyphens, starting and ending with a letter or number." |
* | "language_label" | "Language of the page" |
* | "enabled_label" | "Public" |
* | "enabled_hint" | "Anyone with the address can read it. Off, it's a draft only members see here." |
* | "save" | "Save" |
* | "saving" | "Saving…" |
* | "saved" | "Saved." |
* | "save_failed" | "Couldn't save. Try again." |
* | "slug_taken" | "Another workspace already uses that address. Pick another one." |
* | "not_applied" | "Saved, but the page may take a minute to show it." |
* | "live" | "Public at {url}" |
* | "draft" | "Draft: not public yet." |
* | "open" | "Open" |
* | "components_title" | "Components" |
* | "components_hint" | "What the page lists, for example API or Website. A group puts components together under one heading." |
* | "components_empty" | "No components yet." |
* | "component_name" | "Name" |
* | "component_name_required" | "A component needs a name." |
* | "component_group" | "Group (optional)" |
* | "component_status" | "Status set by hand" |
* | "component_status_hint" | "The page shows the worse of this and the impact of any open incident published on it." |
* | "add" | "Add component" |
* | "adding" | "Adding…" |
* | "add_failed" | "Couldn't add the component. Try again." |
* | "limit" | "A status page can list at most 50 components." |
* | "edit" | "Edit" |
* | "cancel" | "Cancel" |
* | "delete" | "Delete" |
* | "delete_confirm" | "Delete {name}? It's taken off the page and out of every incident published on it." |
* | "keep" | "Keep" |
* | "delete_failed" | "Couldn't delete. Try again." |
* | "ungrouped" | "No group" |
* | "publish_title" | "Status page" |
* | "publish_none" | "Nothing about this incident is on the status page." |
* | "publish_not_set_up" | "Set up a status page in the dashboard to tell customers about incidents." |
* | "publish_viewer" | "Owners, admins and responders can publish to the status page." |
* | "publish_current" | "On the status page as {status}." |
* | "publish_open" | "Publish an update" |
* | "publish_hint" | "Written for the public: it appears on the status page as you write it. The internal timeline stays private." |
* | "public_title" | "Public title" |
* | "public_status" | "Status" |
* | "public_impact" | "Impact" |
* | "public_components" | "Affected components" |
* | "public_body" | "Update" |
* | "impact_operational" | "No impact" |
* | "publish" | "Publish" |
* | "publishing" | "Publishing…" |
* | "publish_failed" | "Couldn't publish. Try again." |
* | "published" | "Published." |
* | "public_title_required" | "The public needs a title, without invisible characters." |
* | "public_body_required" | "Write what the public should know." |
* | "cache_window" | "Changes reach visitors within about 2 minutes: until then, caches may still show the page as it was." |
* | "published_updates" | "On the page now" |
* | "update_edit_label" | "Correct the update from {name}" |
* | "update_remove_label" | "Remove the update from {name}" |
* | "remove" | "Remove" |
* | "update_remove_confirm" | "Remove this update from the status page? Visitors may still see it for about 2 minutes, until caches catch up. The timeline keeps a record." |
* | "withdraw" | "Take off the page" |
* | "withdraw_confirm" | "Take this incident and all its updates off the status page? Visitors may still see it for about 2 minutes, until caches catch up. The timeline keeps a record." |
* | "withdrawn" | "Taken off the page. Visitors may still see it for about 2 minutes." |
* | "corrected" | "Corrected. Visitors may still see the old version for about 2 minutes." |
* | "correct_failed" | "Couldn't change the status page. Try again." |
* | * | "Status page" |
*
* @param {Status_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const status_card = /** @type {((inputs: Status_CardInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_CardInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Página de status`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`Uma página pública onde clientes veem quais partes do seu serviço funcionam e o que você conta sobre incidentes. Nada da linha do tempo interna aparece lá a menos que alguém publique.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Não foi possível carregar as configurações da página de status.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Tentar de novo`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Só proprietários e administradores podem configurar a página de status ou mudar seus componentes.`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`Ainda não há página de status.`);
		if (i?.part === "set_up") return /** @type {LocalizedString} */ (`Configurar`);
		if (i?.part === "title_label") return /** @type {LocalizedString} */ (`Nome exibido na página`);
		if (i?.part === "title_hint") return /** @type {LocalizedString} */ (`Normalmente o nome da sua empresa ou produto.`);
		if (i?.part === "title_required") return /** @type {LocalizedString} */ (`A página precisa de um nome de até 80 caracteres, sem caracteres invisíveis.`);
		if (i?.part === "slug_label") return /** @type {LocalizedString} */ (`Endereço`);
		if (i?.part === "slug_hint") return /** @type {LocalizedString} */ (`De 3 a 40 letras minúsculas, números e hifens.`);
		if (i?.part === "slug_invalid") return /** @type {LocalizedString} */ (`Use de 3 a 40 letras minúsculas, números e hifens simples, começando e terminando com letra ou número.`);
		if (i?.part === "language_label") return /** @type {LocalizedString} */ (`Idioma da página`);
		if (i?.part === "enabled_label") return /** @type {LocalizedString} */ (`Pública`);
		if (i?.part === "enabled_hint") return /** @type {LocalizedString} */ (`Qualquer pessoa com o endereço pode ler. Desligada, é um rascunho que só membros veem aqui.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Salvar`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Salvando…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Salvo.`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Não foi possível salvar. Tente de novo.`);
		if (i?.part === "slug_taken") return /** @type {LocalizedString} */ (`Outro espaço de trabalho já usa esse endereço. Escolha outro.`);
		if (i?.part === "not_applied") return /** @type {LocalizedString} */ (`Salvo, mas a página pode levar um minuto para mostrar.`);
		if (i?.part === "live") return /** @type {LocalizedString} */ (`Pública em ${i?.url}`);
		if (i?.part === "draft") return /** @type {LocalizedString} */ (`Rascunho: ainda não é pública.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Abrir`);
		if (i?.part === "components_title") return /** @type {LocalizedString} */ (`Componentes`);
		if (i?.part === "components_hint") return /** @type {LocalizedString} */ (`O que a página lista, por exemplo API ou Site. Um grupo junta componentes sob um mesmo título.`);
		if (i?.part === "components_empty") return /** @type {LocalizedString} */ (`Nenhum componente ainda.`);
		if (i?.part === "component_name") return /** @type {LocalizedString} */ (`Nome`);
		if (i?.part === "component_name_required") return /** @type {LocalizedString} */ (`Um componente precisa de um nome.`);
		if (i?.part === "component_group") return /** @type {LocalizedString} */ (`Grupo (opcional)`);
		if (i?.part === "component_status") return /** @type {LocalizedString} */ (`Status definido à mão`);
		if (i?.part === "component_status_hint") return /** @type {LocalizedString} */ (`A página mostra o pior entre este e o impacto de qualquer incidente aberto publicado nele.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Adicionar componente`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Adicionando…`);
		if (i?.part === "add_failed") return /** @type {LocalizedString} */ (`Não foi possível adicionar o componente. Tente de novo.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`Uma página de status lista no máximo 50 componentes.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Editar`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancelar`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Excluir`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Ele sai da página e de todos os incidentes publicados nele.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Manter`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Não foi possível excluir. Tente de novo.`);
		if (i?.part === "ungrouped") return /** @type {LocalizedString} */ (`Sem grupo`);
		if (i?.part === "publish_title") return /** @type {LocalizedString} */ (`Página de status`);
		if (i?.part === "publish_none") return /** @type {LocalizedString} */ (`Nada sobre este incidente está na página de status.`);
		if (i?.part === "publish_not_set_up") return /** @type {LocalizedString} */ (`Configure uma página de status no painel para avisar clientes sobre incidentes.`);
		if (i?.part === "publish_viewer") return /** @type {LocalizedString} */ (`Proprietários, administradores e respondedores podem publicar na página de status.`);
		if (i?.part === "publish_current") return /** @type {LocalizedString} */ (`Na página de status como ${i?.status}.`);
		if (i?.part === "publish_open") return /** @type {LocalizedString} */ (`Publicar uma atualização`);
		if (i?.part === "publish_hint") return /** @type {LocalizedString} */ (`Escrita para o público: aparece na página de status como você escrever. A linha do tempo interna continua privada.`);
		if (i?.part === "public_title") return /** @type {LocalizedString} */ (`Título público`);
		if (i?.part === "public_status") return /** @type {LocalizedString} */ (`Status`);
		if (i?.part === "public_impact") return /** @type {LocalizedString} */ (`Impacto`);
		if (i?.part === "public_components") return /** @type {LocalizedString} */ (`Componentes afetados`);
		if (i?.part === "public_body") return /** @type {LocalizedString} */ (`Atualização`);
		if (i?.part === "impact_operational") return /** @type {LocalizedString} */ (`Sem impacto`);
		if (i?.part === "publish") return /** @type {LocalizedString} */ (`Publicar`);
		if (i?.part === "publishing") return /** @type {LocalizedString} */ (`Publicando…`);
		if (i?.part === "publish_failed") return /** @type {LocalizedString} */ (`Não foi possível publicar. Tente de novo.`);
		if (i?.part === "published") return /** @type {LocalizedString} */ (`Publicado.`);
		if (i?.part === "public_title_required") return /** @type {LocalizedString} */ (`O público precisa de um título, sem caracteres invisíveis.`);
		if (i?.part === "public_body_required") return /** @type {LocalizedString} */ (`Escreva o que o público precisa saber.`);
		if (i?.part === "cache_window") return /** @type {LocalizedString} */ (`Mudanças chegam aos visitantes em cerca de 2 minutos: até lá, caches podem ainda mostrar a página como estava.`);
		if (i?.part === "published_updates") return /** @type {LocalizedString} */ (`Na página agora`);
		if (i?.part === "update_edit_label") return /** @type {LocalizedString} */ (`Corrigir a atualização de ${i?.name}`);
		if (i?.part === "update_remove_label") return /** @type {LocalizedString} */ (`Remover a atualização de ${i?.name}`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remover`);
		if (i?.part === "update_remove_confirm") return /** @type {LocalizedString} */ (`Remover esta atualização da página de status? Visitantes podem ainda vê-la por cerca de 2 minutos, até os caches se atualizarem. A linha do tempo guarda um registro.`);
		if (i?.part === "withdraw") return /** @type {LocalizedString} */ (`Tirar da página`);
		if (i?.part === "withdraw_confirm") return /** @type {LocalizedString} */ (`Tirar este incidente e todas as atualizações dele da página de status? Visitantes podem ainda vê-lo por cerca de 2 minutos, até os caches se atualizarem. A linha do tempo guarda um registro.`);
		if (i?.part === "withdrawn") return /** @type {LocalizedString} */ (`Tirado da página. Visitantes podem ainda vê-lo por cerca de 2 minutos.`);
		if (i?.part === "corrected") return /** @type {LocalizedString} */ (`Corrigido. Visitantes podem ainda ver a versão anterior por cerca de 2 minutos.`);
		if (i?.part === "correct_failed") return /** @type {LocalizedString} */ (`Não foi possível alterar a página de status. Tente de novo.`);
		return /** @type {LocalizedString} */ (`Página de status`)
	}
	{
		if (i?.part === "title") return /** @type {LocalizedString} */ (`Status page`);
		if (i?.part === "description") return /** @type {LocalizedString} */ (`A public page where customers see which parts of your service work and what you tell them about incidents. Nothing from the internal timeline appears there unless someone publishes it.`);
		if (i?.part === "load_failed") return /** @type {LocalizedString} */ (`Couldn't load the status page settings.`);
		if (i?.part === "retry") return /** @type {LocalizedString} */ (`Try again`);
		if (i?.part === "manage_only") return /** @type {LocalizedString} */ (`Only owners and admins can set up the status page or change its components.`);
		if (i?.part === "not_set_up") return /** @type {LocalizedString} */ (`No status page yet.`);
		if (i?.part === "set_up") return /** @type {LocalizedString} */ (`Set up`);
		if (i?.part === "title_label") return /** @type {LocalizedString} */ (`Name shown on the page`);
		if (i?.part === "title_hint") return /** @type {LocalizedString} */ (`Usually your company's or product's name.`);
		if (i?.part === "title_required") return /** @type {LocalizedString} */ (`The page needs a name of up to 80 characters, without invisible characters.`);
		if (i?.part === "slug_label") return /** @type {LocalizedString} */ (`Address`);
		if (i?.part === "slug_hint") return /** @type {LocalizedString} */ (`3 to 40 lowercase letters, numbers and hyphens.`);
		if (i?.part === "slug_invalid") return /** @type {LocalizedString} */ (`Use 3 to 40 lowercase letters, numbers and single hyphens, starting and ending with a letter or number.`);
		if (i?.part === "language_label") return /** @type {LocalizedString} */ (`Language of the page`);
		if (i?.part === "enabled_label") return /** @type {LocalizedString} */ (`Public`);
		if (i?.part === "enabled_hint") return /** @type {LocalizedString} */ (`Anyone with the address can read it. Off, it's a draft only members see here.`);
		if (i?.part === "save") return /** @type {LocalizedString} */ (`Save`);
		if (i?.part === "saving") return /** @type {LocalizedString} */ (`Saving…`);
		if (i?.part === "saved") return /** @type {LocalizedString} */ (`Saved.`);
		if (i?.part === "save_failed") return /** @type {LocalizedString} */ (`Couldn't save. Try again.`);
		if (i?.part === "slug_taken") return /** @type {LocalizedString} */ (`Another workspace already uses that address. Pick another one.`);
		if (i?.part === "not_applied") return /** @type {LocalizedString} */ (`Saved, but the page may take a minute to show it.`);
		if (i?.part === "live") return /** @type {LocalizedString} */ (`Public at ${i?.url}`);
		if (i?.part === "draft") return /** @type {LocalizedString} */ (`Draft: not public yet.`);
		if (i?.part === "open") return /** @type {LocalizedString} */ (`Open`);
		if (i?.part === "components_title") return /** @type {LocalizedString} */ (`Components`);
		if (i?.part === "components_hint") return /** @type {LocalizedString} */ (`What the page lists, for example API or Website. A group puts components together under one heading.`);
		if (i?.part === "components_empty") return /** @type {LocalizedString} */ (`No components yet.`);
		if (i?.part === "component_name") return /** @type {LocalizedString} */ (`Name`);
		if (i?.part === "component_name_required") return /** @type {LocalizedString} */ (`A component needs a name.`);
		if (i?.part === "component_group") return /** @type {LocalizedString} */ (`Group (optional)`);
		if (i?.part === "component_status") return /** @type {LocalizedString} */ (`Status set by hand`);
		if (i?.part === "component_status_hint") return /** @type {LocalizedString} */ (`The page shows the worse of this and the impact of any open incident published on it.`);
		if (i?.part === "add") return /** @type {LocalizedString} */ (`Add component`);
		if (i?.part === "adding") return /** @type {LocalizedString} */ (`Adding…`);
		if (i?.part === "add_failed") return /** @type {LocalizedString} */ (`Couldn't add the component. Try again.`);
		if (i?.part === "limit") return /** @type {LocalizedString} */ (`A status page can list at most 50 components.`);
		if (i?.part === "edit") return /** @type {LocalizedString} */ (`Edit`);
		if (i?.part === "cancel") return /** @type {LocalizedString} */ (`Cancel`);
		if (i?.part === "delete") return /** @type {LocalizedString} */ (`Delete`);
		if (i?.part === "delete_confirm") return /** @type {LocalizedString} */ (`Delete ${i?.name}? It's taken off the page and out of every incident published on it.`);
		if (i?.part === "keep") return /** @type {LocalizedString} */ (`Keep`);
		if (i?.part === "delete_failed") return /** @type {LocalizedString} */ (`Couldn't delete. Try again.`);
		if (i?.part === "ungrouped") return /** @type {LocalizedString} */ (`No group`);
		if (i?.part === "publish_title") return /** @type {LocalizedString} */ (`Status page`);
		if (i?.part === "publish_none") return /** @type {LocalizedString} */ (`Nothing about this incident is on the status page.`);
		if (i?.part === "publish_not_set_up") return /** @type {LocalizedString} */ (`Set up a status page in the dashboard to tell customers about incidents.`);
		if (i?.part === "publish_viewer") return /** @type {LocalizedString} */ (`Owners, admins and responders can publish to the status page.`);
		if (i?.part === "publish_current") return /** @type {LocalizedString} */ (`On the status page as ${i?.status}.`);
		if (i?.part === "publish_open") return /** @type {LocalizedString} */ (`Publish an update`);
		if (i?.part === "publish_hint") return /** @type {LocalizedString} */ (`Written for the public: it appears on the status page as you write it. The internal timeline stays private.`);
		if (i?.part === "public_title") return /** @type {LocalizedString} */ (`Public title`);
		if (i?.part === "public_status") return /** @type {LocalizedString} */ (`Status`);
		if (i?.part === "public_impact") return /** @type {LocalizedString} */ (`Impact`);
		if (i?.part === "public_components") return /** @type {LocalizedString} */ (`Affected components`);
		if (i?.part === "public_body") return /** @type {LocalizedString} */ (`Update`);
		if (i?.part === "impact_operational") return /** @type {LocalizedString} */ (`No impact`);
		if (i?.part === "publish") return /** @type {LocalizedString} */ (`Publish`);
		if (i?.part === "publishing") return /** @type {LocalizedString} */ (`Publishing…`);
		if (i?.part === "publish_failed") return /** @type {LocalizedString} */ (`Couldn't publish. Try again.`);
		if (i?.part === "published") return /** @type {LocalizedString} */ (`Published.`);
		if (i?.part === "public_title_required") return /** @type {LocalizedString} */ (`The public needs a title, without invisible characters.`);
		if (i?.part === "public_body_required") return /** @type {LocalizedString} */ (`Write what the public should know.`);
		if (i?.part === "cache_window") return /** @type {LocalizedString} */ (`Changes reach visitors within about 2 minutes: until then, caches may still show the page as it was.`);
		if (i?.part === "published_updates") return /** @type {LocalizedString} */ (`On the page now`);
		if (i?.part === "update_edit_label") return /** @type {LocalizedString} */ (`Correct the update from ${i?.name}`);
		if (i?.part === "update_remove_label") return /** @type {LocalizedString} */ (`Remove the update from ${i?.name}`);
		if (i?.part === "remove") return /** @type {LocalizedString} */ (`Remove`);
		if (i?.part === "update_remove_confirm") return /** @type {LocalizedString} */ (`Remove this update from the status page? Visitors may still see it for about 2 minutes, until caches catch up. The timeline keeps a record.`);
		if (i?.part === "withdraw") return /** @type {LocalizedString} */ (`Take off the page`);
		if (i?.part === "withdraw_confirm") return /** @type {LocalizedString} */ (`Take this incident and all its updates off the status page? Visitors may still see it for about 2 minutes, until caches catch up. The timeline keeps a record.`);
		if (i?.part === "withdrawn") return /** @type {LocalizedString} */ (`Taken off the page. Visitors may still see it for about 2 minutes.`);
		if (i?.part === "corrected") return /** @type {LocalizedString} */ (`Corrected. Visitors may still see the old version for about 2 minutes.`);
		if (i?.part === "correct_failed") return /** @type {LocalizedString} */ (`Couldn't change the status page. Try again.`);
		return /** @type {LocalizedString} */ (`Status page`)
	}
});