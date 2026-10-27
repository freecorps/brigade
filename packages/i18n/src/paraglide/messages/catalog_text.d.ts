export type LocalizedString = import('../runtime.js').LocalizedString;
export type Catalog_TextInputs = {
    text: NonNullable<unknown>;
    name: NonNullable<unknown>;
    reason: NonNullable<unknown>;
};
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
* | "policy_note" | "Incidents that name this service page through this policy, unless their alert route or incident type has one. The order is: alert route, incident type, the i..." |
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
export declare const catalog_text: ((inputs: Catalog_TextInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Catalog_TextInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
