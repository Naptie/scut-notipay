import { CARD_BASE } from './constants.js';

const getKeyboard = async () => {
  const response = await fetch(
    `${CARD_BASE}/berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5`
  );
  const { data } = (await response.json()) as { data: { numberKeyboard: string; uuid: string } };
  return { keyboard: data.numberKeyboard, uuid: data.uuid };
};

export const encryptPassword = async (password: string) => {
  const { keyboard, uuid } = await getKeyboard();
  return (
    Array.from(password)
      .map((char) => keyboard.charAt(parseInt(char, 10)))
      .join('') +
    '$1$' +
    uuid
  );
};
