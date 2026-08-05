export const USER_CENTER_HASH = "#user-center";
export const USER_CENTER_RETURN_LABEL = "返回用户中心";

/**
 * Account subviews never inherit an empty or stale fragment as their return
 * target. They all resolve to the account hub route.
 */
export function resolveUserCenterReturnHash(target: string | null | undefined): string {
    const normalized = target?.trim();
    if (normalized === USER_CENTER_HASH || normalized === USER_CENTER_HASH.slice(1)) {
        return USER_CENTER_HASH;
    }
    return USER_CENTER_HASH;
}

export function isUserCenterHash(hash: string | null | undefined): boolean {
    return hash === USER_CENTER_HASH;
}
