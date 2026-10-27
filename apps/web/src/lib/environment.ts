// Which deployment this dashboard is, fixed when it was built (src/lib/build-environment.ts). The header's badge and
// the overview's wording (`m.environment`) follow it, so a deployed dashboard never says it runs on your machine.

import type { Environment } from "./build-environment";

export type { Environment };

export const ENVIRONMENT: Environment = import.meta.env.BRIGADE_ENV;
