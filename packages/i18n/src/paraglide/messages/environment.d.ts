export type LocalizedString = import('../runtime.js').LocalizedString;
export type EnvironmentInputs = {
    env: NonNullable<unknown>;
    part: NonNullable<unknown>;
};
/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{ env: NonNullable<unknown>, part: NonNullable<unknown> }} EnvironmentInputs */
/**
* | env | part | output |
* | --- | --- | --- |
* | "local" | "badge" | "Local" |
* | "local" | "overview" | "The dashboard, its Worker, the API Worker and a Durable Object, all running on your machine." |
* | "local" | "stack" | "Local stack" |
* | "local" | "checking" | "Checking the local stack…" |
* | "dev" | "badge" | "Dev" |
* | "dev" | "overview" | "A development deployment on Cloudflare, for trying changes: the dashboard, its Worker, the API Worker and a Durable Object." |
* | "dev" | "stack" | "Dev stack" |
* | "dev" | "checking" | "Checking the dev stack…" |
* | "dev" | "hint" | "Look for the error in this deployment's Worker logs, then check again." |
* | "staging" | "badge" | "Staging" |
* | "staging" | "overview" | "A staging deployment on Cloudflare, for trying a release before production: the dashboard, its Worker, the API Worker and a Durable Object." |
* | "staging" | "stack" | "Staging stack" |
* | "staging" | "checking" | "Checking the staging stack…" |
* | "staging" | "hint" | "Look for the error in this deployment's Worker logs, then check again." |
* | * | "overview" | "Your workspace's incidents, who is on call, and who gets paged." |
* | * | "stack" | "Services" |
* | * | "checking" | "Checking the services…" |
* | * | "hint" | "Try again in a moment. If it keeps failing, tell whoever runs this Brigade." |
* | * | * | "Brigade" |
*
* @param {EnvironmentInputs} inputs
* @param {{ locale?: "en" | "pt-BR" }} options
* @returns {LocalizedString}
*/
export declare const environment: ((inputs: EnvironmentInputs, options?: {
    locale?: "en" | "pt-BR";
}) => LocalizedString) & import('../runtime.js').MessageMetadata<EnvironmentInputs, {
    locale?: "en" | "pt-BR";
}, {}>;
