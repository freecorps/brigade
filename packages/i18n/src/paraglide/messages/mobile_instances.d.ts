export type LocalizedString = import('../runtime.js').LocalizedString;
export type Mobile_InstancesInputs = {
    part: NonNullable<unknown>;
    host: NonNullable<unknown>;
    name: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown>, name: NonNullable<unknown> }} Mobile_InstancesInputs */
/**
* | part | output |
* | --- | --- |
* | "add_title" | "Add an instance" |
* | "add_intro" | "Brigade can sign you in to several instances at once and page you from each of them." |
* | "another" | "Another instance" |
* | "default_hint" | "The Brigade this app is set up for" |
* | "address_label" | "Address" |
* | "address_hint" | "The address of your company's Brigade dashboard, like brigade.example.com." |
* | "continue" | "Continue" |
* | "checking" | "Checking…" |
* | "scan" | "Scan a QR code" |
* | "scan_hint" | "On the dashboard, open Use the app." |
* | "invalid" | "Enter the address of a Brigade dashboard, like brigade.example.com." |
* | "insecure" | "Brigade only connects over HTTPS. Check that the address starts with https://." |
* | "not_brigade" | "This address is not a Brigade instance." |
* | "unreachable" | "Couldn't reach {host}. Check the address and your connection, then try again." |
* | "own_app_title" | "This instance uses its own app build" |
* | "own_app_body" | "{host} pages its members through its own app. This app could sign in there, but it would never be paged. Install your company's app from the dashboard's Use ..." |
* | "own_app_link" | "Get your company's app" |
* | "update_title" | "Update the app" |
* | "update_body" | "{host} needs a newer version of Brigade. Update the app, then try again." |
* | "no_relay" | "This instance cannot page this phone" |
* | "no_relay_body" | "You can sign in and follow incidents, but {host} has no push set up for this app, so this phone won't be paged." |
* | "signing_in_to" | "You are signing in to {host}" |
* | "already" | "You're already signed in to {host} on this phone." |
* | "open_instance" | "Open {host}" |
* | "sign_in_question" | "Sign in to {host}?" |
* | "sign_in_question_body" | "Continue only if you showed this code on {host}'s dashboard yourself, just now." |
* | "sign_in" | "Sign in" |
* | "claiming" | "Asking {host}…" |
* | "number_title" | "Type this number on the dashboard" |
* | "number_never_share" | "Never share this number. Nobody from Brigade or your company will ask you for it." |
* | "number_waiting" | "Waiting for you to type it on {host}'s dashboard…" |
* | "signed_in_as" | "Signed in to {host} as {name}" |
* | "ended_title" | "Not signed in" |
* | "ended_denied" | "The sign-in was denied on the dashboard." |
* | "ended_wrong_number" | "A different number was typed on the dashboard, so the sign-in ended. Show a new code to try again." |
* | "ended_timeout" | "The code expired. Show a new one on the dashboard and scan it again." |
* | "ended_delivered" | "This sign-in was already used. Show a new code to sign in." |
* | "ended_signed_out" | "The dashboard that showed the code signed out, so the sign-in ended." |
* | "ended_invalid_code" | "This code was already used or has expired. Show a new one on the dashboard." |
* | "ended_rate_limited" | "Too many tries from this network. Wait a minute, then scan again." |
* | "ended_unreachable" | "Couldn't reach {host}. Check your connection, then scan the code again." |
* | "ended_lost" | "{host} no longer knows this sign-in. Show a new code to try again." |
* | "ended_not_stored" | "The sign-in was approved, but this phone couldn't keep the session. Sign in with your password instead." |
* | "close" | "Close" |
* | "camera_needed" | "Brigade needs the camera to scan the QR code on the dashboard's Use the app page." |
* | "camera_allow" | "Allow the camera" |
* | "scan_not_brigade" | "This QR code isn't from Brigade. On the dashboard, open Use the app." |
* | "instances" | "Instances" |
* | "details" | "About this instance" |
* | "details_hint" | "Its address, its relay and whether it pages this phone" |
* | "relay_title" | "Pages" |
* | "relay_freecorps" | "Pages go through Freecorps' relay" |
* | "relay_own" | "Pages go through its own relay ({host})" |
* | "relay_none" | "No relay: this instance cannot page this phone" |
* | "relay_unknown" | "Couldn't check which relay it uses" |
* | "relay_default_raw" | "Pages come straight from this instance, which this app is set up for" |
* | "foreign_body" | "This instance uses its own app: install your company's app from its dashboard's Use the app page." |
* | "signed_in_as_row" | "Signed in as {name}" |
* | "signed_out" | "Signed out" |
* | "loading" | "Loading…" |
* | "paging_foreign" | "Not paged here: it uses its own app" |
* | "paging_no_relay" | "This instance cannot page this phone" |
* | "remove" | "Remove from this phone" |
* | "remove_title" | "Remove {host}?" |
* | "remove_body" | "You'll be signed out of {host} and this phone stops getting its pages. Your other instances stay as they are." |
* | "remove_body_signed_out" | "{host} leaves this phone. Your other instances stay as they are." |
* | "remove_on_call" | "You're on call there now ({name}). Make sure someone covers you before you go." |
* | "remove_on_call_unknown" | "If you're on call there, make sure someone covers you before you go." |
* | "remove_last" | "This is the only instance on this phone. To leave it, sign out instead." |
* | "removing" | "Removing…" |
* | "remove_kept" | "Couldn't reach {host}, so it may still page this phone. You're signed out here, and Brigade finishes signing you out there once it's back online. Remove it t..." |
* | "remove_failed" | "Couldn't remove {host}. Try again." |
* | "other_instances" | "Your other instances" |
* | "unnamed" | "Workspace" |
* | "open" | "Open" |
* | "current" | "Open now" |
* | "check_question" | "Connect to {host}?" |
* | "check_body" | "A link asked Brigade to connect to {host}. Brigade contacts it only if you continue. Continue only if you opened this link from your company's Brigade dashbo..." |
* | "sign_out_first" | "Sign out of it, then continue" |
* | "sign_out_first_hint" | "Signs you out of {host} on this phone first, as Sign out does, so it stops paging you here. Then this code signs you in." |
* | "ended_already" | "You're already signed in to {host} on this phone, so this sign-in wasn't used. It's listed in the account's sessions on the dashboard, where you can sign it ..." |
* | "add_failed" | "Couldn't add this instance on this phone. Try again." |
* | * | "Instances" |
*
* @param {Mobile_InstancesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const mobile_instances: ((inputs: Mobile_InstancesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Mobile_InstancesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
