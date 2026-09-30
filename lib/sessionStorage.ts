// Web uses browser storage; static rendering has no persisted browser session.
export const sessionStorage = typeof localStorage === 'undefined' ? undefined : localStorage;
