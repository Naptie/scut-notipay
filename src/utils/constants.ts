export const APP_NAME = 'scut-notipay';
export const GITHUB_LINK = 'https://github.com/Naptie/scut-notipay';

const BASE_PREFIX = process.env.BASE_PREFIX || '';
export const CARD_BASE = `${BASE_PREFIX}https://ecardwxnew.scut.edu.cn`;
export const DFYC_BASE = `${BASE_PREFIX}https://dfyc.utc.scut.edu.cn`;

export const CAMPUSES = ['GZIC', 'DXC'] as const;

export const NORETRY_ERROR_PREFIX = '[NORETRY]';
