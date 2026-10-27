export type LocalizedString = import('../runtime.js').LocalizedString;
export type Status_CardInputs = {
    part: NonNullable<unknown>;
    url: NonNullable<unknown>;
    name: NonNullable<unknown>;
    status: NonNullable<unknown>;
};
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
* | "uptime_label" | "Uptime bar from monitors" |
* | "uptime_hint" | "The page shows 90 days of uptime from these monitors, from when they were created. Leave all unchecked for no bar." |
* | "uptime_no_monitors" | "No monitors yet. Add one under Monitors to show an uptime bar." |
* | "uptime_from" | "Uptime from {name}" |
* | "uptime_limit" | "At most 5 monitors per component." |
* | "order_hint" | "The public page lists them in this order, ungrouped ones first; a group comes where its first component is." |
* | "move_up" | "Move {name} up" |
* | "move_down" | "Move {name} down" |
* | "move_group_up" | "Move the {name} group up" |
* | "move_group_down" | "Move the {name} group down" |
* | "moved" | "Moved {name}." |
* | "reorder_failed" | "Couldn't change the order. Try again." |
* | "services_label" | "Services" |
* | "services_hint" | "An incident naming one of these services starts with this component ticked when publishing to the page. Nothing is published on its own." |
* | "services_none" | "No services yet. Add them under Services to link them here." |
* | "services_limit" | "At most 10 services per component." |
* | "services_from" | "Services: {name}" |
* | "preselected" | "Ticked from the incident's services. Check them before publishing." |
* | * | "Status page" |
*
* @param {Status_CardInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const status_card: ((inputs: Status_CardInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_CardInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
