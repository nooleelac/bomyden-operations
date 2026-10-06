import "server-only";

import { cache } from "react";

/** Thời điểm của request hiện tại — cố định trong suốt 1 lần render phía server. */
export const getRequestTime = cache((): number => Date.now());
