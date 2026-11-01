export type LocalizedString = import('../runtime.js').LocalizedString;
export type Phones_PagesInputs = {
    part: NonNullable<unknown>;
    host: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ part: NonNullable<unknown>, host: NonNullable<unknown> }} Phones_PagesInputs */
/**
* | part | output |
* | --- | --- |
* | "title" | "Phones and pages" |
* | "description" | "Which relay this instance sends pages to phones through, and whether its last check got through. Only owners and admins see this." |
* | "relay_label" | "Relay" |
* | "relay_freecorps" | "Pages go through Freecorps' relay" |
* | "relay_own" | "Pages go through your company's own relay" |
* | "relay_own_host" | "Pages go through your company's own relay ({host})" |
* | "relay_none" | "No relay: phones aren't paged" |
* | "relay_unknown" | "Couldn't tell which relay pages go through." |
* | "freecorps_hint" | "It pages the Brigade app from the App Store and Google Play." |
* | "own_hint" | "It pages only your company's own build of the Brigade app: the Brigade app in the stores can't get its pages." |
* | "none_hint" | "No push relay is set up, so phones get no pages. Pages still go out by email when this instance can send email. To page phones, set up a relay from the machi..." |
* | "state_label" | "State" |
* | "app_label" | "App to install" |
* | "app_none" | "No link to your company's app is set, so members aren't told where to get it. Add one (RELAY_APP_URL) when you run setup again:" |
* | "checking" | "Checking…" |
* | "state_working" | "Working" |
* | "hint_working" | "The last check reached the relay and it answered." |
* | "state_not_checked" | "Not checked yet" |
* | "hint_not_checked" | "The paging self-check runs every minute once the instance is deployed, and it hasn't run yet." |
* | "state_unregistered" | "Not registered" |
* | "hint_unregistered_freecorps" | "This instance isn't registered on Freecorps' relay, or its registration wasn't finished (it needs the code emailed to your contact). Run:" |
* | "hint_unregistered_own" | "This instance isn't registered on your relay. Run setup again:" |
* | "state_refused" | "Refused" |
* | "hint_bad_signature" | "The relay doesn't accept this instance's key, or this server's clock is more than 5 minutes off. Check that RELAY_INSTANCE_KEY is the key you saved and, afte..." |
* | "hint_revoked_freecorps" | "Freecorps revoked this instance on its relay. Write to Freecorps to find out why before you register again." |
* | "hint_revoked_own" | "This instance was revoked on your relay. Register it again:" |
* | "hint_unauthorized_freecorps" | "The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Set the same RELAY_SEND_TOKEN on the relay and o..." |
* | "hint_unauthorized_own" | "The relay refused the send token (RELAY_SEND_TOKEN), so phones registered before relay handles aren't paged. Run setup again to set a matching token:" |
* | "state_unreachable" | "Unreachable" |
* | "hint_unreachable_freecorps" | "Freecorps' relay isn't answering. Check RELAY_URL on the API; if it's right, the relay may be down, and pages go out by email meanwhile." |
* | "hint_unreachable_own" | "Your relay isn't answering. Check that it's deployed and that the API reaches it (the RELAY binding, or RELAY_URL)." |
* | "state_rate_limited" | "Rate limited" |
* | "hint_rate_limited" | "The relay keeps refusing this instance's checks as over its limits. It usually clears on its own; if it lasts, ask whoever runs the relay to raise the limit." |
* | "state_handles_unavailable" | "Handles unavailable" |
* | "hint_handles_freecorps" | "The relay can't open phone handles right now, so phones registered with a relay handle aren't paged through it. If it lasts, write to Freecorps." |
* | "hint_handles_own" | "Your relay can't open phone handles. Deploy the current apps/relay and check its RELAY_HANDLE_KEYS; running setup again keeps the keys it has:" |
* | "state_providers" | "Push service failing" |
* | "hint_providers_freecorps" | "Apple's or Google's push service refused the relay's credentials, or isn't answering. That's on the relay's side: nothing to change on this instance." |
* | "hint_providers_own" | "Apple's or Google's push service refused your relay's credentials, or isn't answering. If you changed the APNs key or the Firebase account, replace them:" |
* | "state_pipeline" | "Held up in Brigade" |
* | "state_database" | "Database not answering" |
* | "hint_database" | "The database (D1) didn't answer a simple read in the last checks. Look at the API's logs; if it lasts, check Cloudflare's status." |
* | "hint_unknown_relay" | "Brigade didn't say which relay this is, so it can't say what to do here. The paging notice on the overview names the reason." |
* | "hint_pipeline" | "Pages are held up before they reach the relay, so it can't be checked. The paging notice on the overview says why." |
* | "state_no_answer" | "Couldn't check" |
* | "hint_no_answer" | "Brigade didn't answer the paging check. It tries again every minute." |
* | "hint_no_details" | "Brigade answered the paging check without saying why it isn't working: your session may have expired. Reload the page, and sign in again if it asks." |
* | * | "Phones and pages" |
*
* @param {Phones_PagesInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const phones_pages: ((inputs: Phones_PagesInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<Phones_PagesInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
