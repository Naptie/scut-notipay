import { BASE } from './constants.js';
import { encryptPassword } from './keyboard.js';

export const obtainToken = async (username: string, password: string) => {
  password = await encryptPassword(password);

  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);
  formData.append('grant_type', 'password');
  formData.append('scope', 'all');
  formData.append('loginForm', 'h5');
  formData.append('logintype', 'card');
  formData.append('device_token', 'h5');
  formData.append('synAccessSource', 'h5');

  const response = await fetch(`${BASE}/berserker-auth/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm06bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm1fc2VjcmV0'
    },
    body: formData.toString()
  });

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    refresh_token: string;
    name: string;
    sno: string;
  };

  return data;
};
