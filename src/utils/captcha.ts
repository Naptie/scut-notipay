import { CARD_BASE } from './constants.js';
import { fetch } from './fetch.js';
// import Tesseract from 'tesseract.js';

export const obtainChallenge = async () => {
  const response = await fetch(`${CARD_BASE}/berserker-auth/oauth/captcha?synAccessSource=h5`);
  const { key, image } = (await response.json()) as { key: string; image: string };
  return { key, image };
};

// export const solveCaptcha = async () => {
//   const { key, image } = await obtainChallenge();
//   const base64Data = image.replace(/^data:image\/png;base64,/, '');
//   const imageBuffer = Buffer.from(base64Data, 'base64');
//   const {
//     data: { text }
//   } = await Tesseract.recognize(imageBuffer, 'eng');
//   return { key, solution: text.replaceAll(/\s+/g, '') };
// };
