/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ text: NonNullable<unknown>, name: NonNullable<unknown>, reason: NonNullable<unknown> }} Catalog_TextInputs */



/**
* | text | output |
* | --- | --- |
* | "services_title" | "Services" |
* | "services_empty" | "No services yet. List what you run, who owns it and how critical it is, so incidents can say what they affect." |
* | "unowned" | "No owner" |
* | "policy_named" | "Escalation: {name}" |
* | "no_policy" | "No escalation policy" |
* | "policy_note" | "Kept for alert routes: pages still go through the incident type's policy, the monitor's, or the default one." |
* | "back" | "Overview" |
* | "loading" | "Loading the service…" |
* | "not_found_title" | "Service not found" |
* | "not_found" | "There is no such service in this workspace. It may have been deleted." |
* | "active_incidents" | "Active incidents" |
* | "active_none" | "No active incident names this service." |
* | "owners" | "Owners" |
* | "description" | "Description" |
* | "no_description" | "No description." |
* | "gone" | "It no longer exists." |
* | "change_failed" | "Couldn't change {name}: {reason}" |
* | "delete_service" | "Delete {name}? Incidents that name it stop showing it." |
* | "delete_type" | "Delete {name}? Its incidents keep their fields and show the type as deleted." |
* | "delete_field" | "Delete {name}? Its values stop showing on every incident, and types stop requiring it." |
* | "settings_title" | "Incident types, fields and roles" |
* | "types_title" | "Types" |
* | "types_empty" | "No incident types yet. A type sets the severity a declare starts with, the escalation policy its pages use and the fields it needs." |
* | "fields_title" | "Custom fields" |
* | "fields_empty" | "No custom fields yet. A field adds a typed detail to every incident: text, one choice, several choices, a number or a link." |
* | "no_default_severity" | "No default severity" |
* | "pages_through" | "Pages through {name}" |
* | "pages_default" | "No policy of its own: the monitor's or the default one pages" |
* | "requires" | "Requires {name}" |
* | "requires_none" | "Requires no field" |
* | "kind_text" | "Text" |
* | "kind_single_select" | "One choice" |
* | "kind_multi_select" | "Several choices" |
* | "kind_number" | "Number" |
* | "kind_link" | "Link" |
* | "kind_fixed" | "A field's kind can't change once it exists." |
* | "option_none" | "None" |
* | "severity_none" | "No default (the form's own)" |
* | "policy_default" | "The default policy" |
* | "details_title" | "Details" |
* | "type_label" | "Type" |
* | "no_type" | "No type" |
* | "deleted_type" | "Deleted type" |
* | "services_label" | "Affected services" |
* | "no_services" | "None named yet" |
* | "add_service" | "Add a service" |
* | "not_set" | "Not set" |
* | "required" | "Required by the type" |
* | "required_badge" | "Required" |
* | "required_note" | "Required fields never hold up declaring, paging or resolving; once filled they can change but not be cleared." |
* | "catalog_link" | "Edit types, fields and roles on the overview." |
* | "dropped" | "People or schedules that are gone were taken out of the owners." |
* | "deleted_schedule" | "Deleted schedule" |
* | "deleted_service" | "Deleted service" |
* | "group_schedules" | "Schedules" |
* | "group_people" | "People" |
* | "roles_title" | "Incident roles" |
* | "roles_note" | "Who does what on an incident. Pages go to the commander first when no escalation policy pages, so it can be renamed but never removed." |
* | "builtin" | "Built-in" |
* | "removed" | "Removed" |
* | "removed_note" | "Not offered on incidents. Whoever already holds it keeps it." |
* | "checklist_none" | "No responsibilities listed" |
* | "builtin_name" | "Leave empty to keep “{name}”, which every reader sees in their language." |
* | "commander_kept" | "Pages go to the commander first, so this role can't be removed." |
* | "delete_role" | "Delete {name}? It stops showing on incidents and leaves every type that lists it." |
* | "remove_role" | "Remove {name}? It stops being offered on incidents and leaves every type that lists it. You can restore it later." |
* | "roles_limit" | "At most 15 roles, the built-in ones included." |
* | "role_off" | "Not listed" |
* | "role_listed" | "To fill" |
* | "role_required" | "Required" |
* | "roles_type_note" | "The incident page shows the commander, then the roles listed here. List none to show every role. Required roles are flagged until someone holds them; nothing..." |
* | "fills_roles" | "Roles: {name}" |
* | "fills_every_role" | "Shows every role" |
* | "required_role" | "{name} (required)" |
* | "responsibilities" | "Responsibilities" |
* | * | "Catalog" |
*
* @param {Catalog_TextInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export const catalog_text = /** @type {((inputs: Catalog_TextInputs, options?: { locale?: "en" | "pt-BR" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_TextInputs, { locale?: "en" | "pt-BR" }, {}>} */ ((i, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "pt-BR") {
		if (i?.text === "services_title") return /** @type {LocalizedString} */ (`Serviços`);
		if (i?.text === "services_empty") return /** @type {LocalizedString} */ (`Nenhum serviço ainda. Liste o que vocês operam, quem é responsável e quão crítico é, para que os incidentes digam o que afetam.`);
		if (i?.text === "unowned") return /** @type {LocalizedString} */ (`Sem responsável`);
		if (i?.text === "policy_named") return /** @type {LocalizedString} */ (`Escalonamento: ${i?.name}`);
		if (i?.text === "no_policy") return /** @type {LocalizedString} */ (`Sem política de escalonamento`);
		if (i?.text === "policy_note") return /** @type {LocalizedString} */ (`Guardada para as rotas de alerta: os chamados ainda passam pela política do tipo de incidente, pela do monitor ou pela padrão.`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Visão geral`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Carregando o serviço…`);
		if (i?.text === "not_found_title") return /** @type {LocalizedString} */ (`Serviço não encontrado`);
		if (i?.text === "not_found") return /** @type {LocalizedString} */ (`Não existe esse serviço neste espaço de trabalho. Talvez tenha sido excluído.`);
		if (i?.text === "active_incidents") return /** @type {LocalizedString} */ (`Incidentes ativos`);
		if (i?.text === "active_none") return /** @type {LocalizedString} */ (`Nenhum incidente ativo cita este serviço.`);
		if (i?.text === "owners") return /** @type {LocalizedString} */ (`Responsáveis`);
		if (i?.text === "description") return /** @type {LocalizedString} */ (`Descrição`);
		if (i?.text === "no_description") return /** @type {LocalizedString} */ (`Sem descrição.`);
		if (i?.text === "gone") return /** @type {LocalizedString} */ (`Não existe mais.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Não foi possível alterar ${i?.name}: ${i?.reason}`);
		if (i?.text === "delete_service") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Os incidentes que o citam deixam de mostrá-lo.`);
		if (i?.text === "delete_type") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Os incidentes dele mantêm os campos e mostram o tipo como excluído.`);
		if (i?.text === "delete_field") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Os valores deixam de aparecer em todos os incidentes e os tipos deixam de exigi-lo.`);
		if (i?.text === "settings_title") return /** @type {LocalizedString} */ (`Tipos, campos e papéis de incidente`);
		if (i?.text === "types_title") return /** @type {LocalizedString} */ (`Tipos`);
		if (i?.text === "types_empty") return /** @type {LocalizedString} */ (`Nenhum tipo de incidente ainda. Um tipo define a severidade com que uma declaração começa, a política de escalonamento dos chamados e os campos de que precisa.`);
		if (i?.text === "fields_title") return /** @type {LocalizedString} */ (`Campos personalizados`);
		if (i?.text === "fields_empty") return /** @type {LocalizedString} */ (`Nenhum campo personalizado ainda. Um campo acrescenta um detalhe tipado a cada incidente: texto, uma escolha, várias escolhas, um número ou um link.`);
		if (i?.text === "no_default_severity") return /** @type {LocalizedString} */ (`Sem severidade padrão`);
		if (i?.text === "pages_through") return /** @type {LocalizedString} */ (`Aciona por ${i?.name}`);
		if (i?.text === "pages_default") return /** @type {LocalizedString} */ (`Sem política própria: aciona pela do monitor ou pela padrão`);
		if (i?.text === "requires") return /** @type {LocalizedString} */ (`Exige ${i?.name}`);
		if (i?.text === "requires_none") return /** @type {LocalizedString} */ (`Não exige campos`);
		if (i?.text === "kind_text") return /** @type {LocalizedString} */ (`Texto`);
		if (i?.text === "kind_single_select") return /** @type {LocalizedString} */ (`Uma escolha`);
		if (i?.text === "kind_multi_select") return /** @type {LocalizedString} */ (`Várias escolhas`);
		if (i?.text === "kind_number") return /** @type {LocalizedString} */ (`Número`);
		if (i?.text === "kind_link") return /** @type {LocalizedString} */ (`Link`);
		if (i?.text === "kind_fixed") return /** @type {LocalizedString} */ (`O tipo de um campo não muda depois que ele existe.`);
		if (i?.text === "option_none") return /** @type {LocalizedString} */ (`Nenhuma`);
		if (i?.text === "severity_none") return /** @type {LocalizedString} */ (`Sem padrão (o do formulário)`);
		if (i?.text === "policy_default") return /** @type {LocalizedString} */ (`A política padrão`);
		if (i?.text === "details_title") return /** @type {LocalizedString} */ (`Detalhes`);
		if (i?.text === "type_label") return /** @type {LocalizedString} */ (`Tipo`);
		if (i?.text === "no_type") return /** @type {LocalizedString} */ (`Sem tipo`);
		if (i?.text === "deleted_type") return /** @type {LocalizedString} */ (`Tipo excluído`);
		if (i?.text === "services_label") return /** @type {LocalizedString} */ (`Serviços afetados`);
		if (i?.text === "no_services") return /** @type {LocalizedString} */ (`Nenhum citado ainda`);
		if (i?.text === "add_service") return /** @type {LocalizedString} */ (`Adicionar um serviço`);
		if (i?.text === "not_set") return /** @type {LocalizedString} */ (`Não preenchido`);
		if (i?.text === "required") return /** @type {LocalizedString} */ (`Exigido pelo tipo`);
		if (i?.text === "required_badge") return /** @type {LocalizedString} */ (`Obrigatório`);
		if (i?.text === "required_note") return /** @type {LocalizedString} */ (`Campos obrigatórios nunca atrasam a declaração, os chamados ou a resolução; depois de preenchidos podem mudar, mas não ficar vazios.`);
		if (i?.text === "catalog_link") return /** @type {LocalizedString} */ (`Edite tipos, campos e papéis na visão geral.`);
		if (i?.text === "dropped") return /** @type {LocalizedString} */ (`Pessoas ou escalas que não existem mais foram tiradas dos responsáveis.`);
		if (i?.text === "deleted_schedule") return /** @type {LocalizedString} */ (`Escala excluída`);
		if (i?.text === "deleted_service") return /** @type {LocalizedString} */ (`Serviço excluído`);
		if (i?.text === "group_schedules") return /** @type {LocalizedString} */ (`Escalas`);
		if (i?.text === "group_people") return /** @type {LocalizedString} */ (`Pessoas`);
		if (i?.text === "roles_title") return /** @type {LocalizedString} */ (`Papéis no incidente`);
		if (i?.text === "roles_note") return /** @type {LocalizedString} */ (`Quem faz o quê em um incidente. Os chamados vão primeiro para o comandante quando nenhuma política de escalonamento aciona, então esse papel pode ser renomeado, mas nunca removido.`);
		if (i?.text === "builtin") return /** @type {LocalizedString} */ (`Padrão`);
		if (i?.text === "removed") return /** @type {LocalizedString} */ (`Removido`);
		if (i?.text === "removed_note") return /** @type {LocalizedString} */ (`Não é oferecido nos incidentes. Quem já o ocupa continua com ele.`);
		if (i?.text === "checklist_none") return /** @type {LocalizedString} */ (`Nenhuma responsabilidade listada`);
		if (i?.text === "builtin_name") return /** @type {LocalizedString} */ (`Deixe vazio para manter “${i?.name}”, que cada leitor vê no seu idioma.`);
		if (i?.text === "commander_kept") return /** @type {LocalizedString} */ (`Os chamados vão primeiro para o comandante, então este papel não pode ser removido.`);
		if (i?.text === "delete_role") return /** @type {LocalizedString} */ (`Excluir ${i?.name}? Ele deixa de aparecer nos incidentes e sai de todos os tipos que o listam.`);
		if (i?.text === "remove_role") return /** @type {LocalizedString} */ (`Remover ${i?.name}? Ele deixa de ser oferecido nos incidentes e sai de todos os tipos que o listam. Você pode restaurá-lo depois.`);
		if (i?.text === "roles_limit") return /** @type {LocalizedString} */ (`No máximo 15 papéis, contando os padrão.`);
		if (i?.text === "role_off") return /** @type {LocalizedString} */ (`Não listado`);
		if (i?.text === "role_listed") return /** @type {LocalizedString} */ (`A preencher`);
		if (i?.text === "role_required") return /** @type {LocalizedString} */ (`Obrigatório`);
		if (i?.text === "roles_type_note") return /** @type {LocalizedString} */ (`A página do incidente mostra o comandante e depois os papéis listados aqui. Não liste nenhum para mostrar todos. Papéis obrigatórios ficam sinalizados até alguém ocupá-los; nada espera por eles.`);
		if (i?.text === "fills_roles") return /** @type {LocalizedString} */ (`Papéis: ${i?.name}`);
		if (i?.text === "fills_every_role") return /** @type {LocalizedString} */ (`Mostra todos os papéis`);
		if (i?.text === "required_role") return /** @type {LocalizedString} */ (`${i?.name} (obrigatório)`);
		if (i?.text === "responsibilities") return /** @type {LocalizedString} */ (`Responsabilidades`);
		return /** @type {LocalizedString} */ (`Catálogo`)
	}
	{
		if (i?.text === "services_title") return /** @type {LocalizedString} */ (`Services`);
		if (i?.text === "services_empty") return /** @type {LocalizedString} */ (`No services yet. List what you run, who owns it and how critical it is, so incidents can say what they affect.`);
		if (i?.text === "unowned") return /** @type {LocalizedString} */ (`No owner`);
		if (i?.text === "policy_named") return /** @type {LocalizedString} */ (`Escalation: ${i?.name}`);
		if (i?.text === "no_policy") return /** @type {LocalizedString} */ (`No escalation policy`);
		if (i?.text === "policy_note") return /** @type {LocalizedString} */ (`Kept for alert routes: pages still go through the incident type's policy, the monitor's, or the default one.`);
		if (i?.text === "back") return /** @type {LocalizedString} */ (`Overview`);
		if (i?.text === "loading") return /** @type {LocalizedString} */ (`Loading the service…`);
		if (i?.text === "not_found_title") return /** @type {LocalizedString} */ (`Service not found`);
		if (i?.text === "not_found") return /** @type {LocalizedString} */ (`There is no such service in this workspace. It may have been deleted.`);
		if (i?.text === "active_incidents") return /** @type {LocalizedString} */ (`Active incidents`);
		if (i?.text === "active_none") return /** @type {LocalizedString} */ (`No active incident names this service.`);
		if (i?.text === "owners") return /** @type {LocalizedString} */ (`Owners`);
		if (i?.text === "description") return /** @type {LocalizedString} */ (`Description`);
		if (i?.text === "no_description") return /** @type {LocalizedString} */ (`No description.`);
		if (i?.text === "gone") return /** @type {LocalizedString} */ (`It no longer exists.`);
		if (i?.text === "change_failed") return /** @type {LocalizedString} */ (`Couldn't change ${i?.name}: ${i?.reason}`);
		if (i?.text === "delete_service") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Incidents that name it stop showing it.`);
		if (i?.text === "delete_type") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Its incidents keep their fields and show the type as deleted.`);
		if (i?.text === "delete_field") return /** @type {LocalizedString} */ (`Delete ${i?.name}? Its values stop showing on every incident, and types stop requiring it.`);
		if (i?.text === "settings_title") return /** @type {LocalizedString} */ (`Incident types, fields and roles`);
		if (i?.text === "types_title") return /** @type {LocalizedString} */ (`Types`);
		if (i?.text === "types_empty") return /** @type {LocalizedString} */ (`No incident types yet. A type sets the severity a declare starts with, the escalation policy its pages use and the fields it needs.`);
		if (i?.text === "fields_title") return /** @type {LocalizedString} */ (`Custom fields`);
		if (i?.text === "fields_empty") return /** @type {LocalizedString} */ (`No custom fields yet. A field adds a typed detail to every incident: text, one choice, several choices, a number or a link.`);
		if (i?.text === "no_default_severity") return /** @type {LocalizedString} */ (`No default severity`);
		if (i?.text === "pages_through") return /** @type {LocalizedString} */ (`Pages through ${i?.name}`);
		if (i?.text === "pages_default") return /** @type {LocalizedString} */ (`No policy of its own: the monitor's or the default one pages`);
		if (i?.text === "requires") return /** @type {LocalizedString} */ (`Requires ${i?.name}`);
		if (i?.text === "requires_none") return /** @type {LocalizedString} */ (`Requires no field`);
		if (i?.text === "kind_text") return /** @type {LocalizedString} */ (`Text`);
		if (i?.text === "kind_single_select") return /** @type {LocalizedString} */ (`One choice`);
		if (i?.text === "kind_multi_select") return /** @type {LocalizedString} */ (`Several choices`);
		if (i?.text === "kind_number") return /** @type {LocalizedString} */ (`Number`);
		if (i?.text === "kind_link") return /** @type {LocalizedString} */ (`Link`);
		if (i?.text === "kind_fixed") return /** @type {LocalizedString} */ (`A field's kind can't change once it exists.`);
		if (i?.text === "option_none") return /** @type {LocalizedString} */ (`None`);
		if (i?.text === "severity_none") return /** @type {LocalizedString} */ (`No default (the form's own)`);
		if (i?.text === "policy_default") return /** @type {LocalizedString} */ (`The default policy`);
		if (i?.text === "details_title") return /** @type {LocalizedString} */ (`Details`);
		if (i?.text === "type_label") return /** @type {LocalizedString} */ (`Type`);
		if (i?.text === "no_type") return /** @type {LocalizedString} */ (`No type`);
		if (i?.text === "deleted_type") return /** @type {LocalizedString} */ (`Deleted type`);
		if (i?.text === "services_label") return /** @type {LocalizedString} */ (`Affected services`);
		if (i?.text === "no_services") return /** @type {LocalizedString} */ (`None named yet`);
		if (i?.text === "add_service") return /** @type {LocalizedString} */ (`Add a service`);
		if (i?.text === "not_set") return /** @type {LocalizedString} */ (`Not set`);
		if (i?.text === "required") return /** @type {LocalizedString} */ (`Required by the type`);
		if (i?.text === "required_badge") return /** @type {LocalizedString} */ (`Required`);
		if (i?.text === "required_note") return /** @type {LocalizedString} */ (`Required fields never hold up declaring, paging or resolving; once filled they can change but not be cleared.`);
		if (i?.text === "catalog_link") return /** @type {LocalizedString} */ (`Edit types, fields and roles on the overview.`);
		if (i?.text === "dropped") return /** @type {LocalizedString} */ (`People or schedules that are gone were taken out of the owners.`);
		if (i?.text === "deleted_schedule") return /** @type {LocalizedString} */ (`Deleted schedule`);
		if (i?.text === "deleted_service") return /** @type {LocalizedString} */ (`Deleted service`);
		if (i?.text === "group_schedules") return /** @type {LocalizedString} */ (`Schedules`);
		if (i?.text === "group_people") return /** @type {LocalizedString} */ (`People`);
		if (i?.text === "roles_title") return /** @type {LocalizedString} */ (`Incident roles`);
		if (i?.text === "roles_note") return /** @type {LocalizedString} */ (`Who does what on an incident. Pages go to the commander first when no escalation policy pages, so it can be renamed but never removed.`);
		if (i?.text === "builtin") return /** @type {LocalizedString} */ (`Built-in`);
		if (i?.text === "removed") return /** @type {LocalizedString} */ (`Removed`);
		if (i?.text === "removed_note") return /** @type {LocalizedString} */ (`Not offered on incidents. Whoever already holds it keeps it.`);
		if (i?.text === "checklist_none") return /** @type {LocalizedString} */ (`No responsibilities listed`);
		if (i?.text === "builtin_name") return /** @type {LocalizedString} */ (`Leave empty to keep “${i?.name}”, which every reader sees in their language.`);
		if (i?.text === "commander_kept") return /** @type {LocalizedString} */ (`Pages go to the commander first, so this role can't be removed.`);
		if (i?.text === "delete_role") return /** @type {LocalizedString} */ (`Delete ${i?.name}? It stops showing on incidents and leaves every type that lists it.`);
		if (i?.text === "remove_role") return /** @type {LocalizedString} */ (`Remove ${i?.name}? It stops being offered on incidents and leaves every type that lists it. You can restore it later.`);
		if (i?.text === "roles_limit") return /** @type {LocalizedString} */ (`At most 15 roles, the built-in ones included.`);
		if (i?.text === "role_off") return /** @type {LocalizedString} */ (`Not listed`);
		if (i?.text === "role_listed") return /** @type {LocalizedString} */ (`To fill`);
		if (i?.text === "role_required") return /** @type {LocalizedString} */ (`Required`);
		if (i?.text === "roles_type_note") return /** @type {LocalizedString} */ (`The incident page shows the commander, then the roles listed here. List none to show every role. Required roles are flagged until someone holds them; nothing waits on them.`);
		if (i?.text === "fills_roles") return /** @type {LocalizedString} */ (`Roles: ${i?.name}`);
		if (i?.text === "fills_every_role") return /** @type {LocalizedString} */ (`Shows every role`);
		if (i?.text === "required_role") return /** @type {LocalizedString} */ (`${i?.name} (required)`);
		if (i?.text === "responsibilities") return /** @type {LocalizedString} */ (`Responsibilities`);
		return /** @type {LocalizedString} */ (`Catalog`)
	}
});