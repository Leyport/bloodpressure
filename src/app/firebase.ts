import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

// Firebase web config is public by design — access is controlled by
// Firestore security rules (firestore.rules) and Firebase AI Logic settings.
const firebaseConfig = {
  apiKey: 'AIzaSyDgXojTJ-n6wYDwbqxZ708Z_H4S-Zhqktk',
  authDomain: 'bloodpressure-731ab.firebaseapp.com',
  projectId: 'bloodpressure-731ab',
  storageBucket: 'bloodpressure-731ab.firebasestorage.app',
  messagingSenderId: '814608959600',
  appId: '1:814608959600:web:fa3c5f0491f1b48c0a0cb5',
  measurementId: 'G-H3GG40WJMP',
};

/** Gemini model used for document review. Change here to switch models. */
export const GEMINI_MODEL = 'gemini-3.6-flash';

/** reCAPTCHA v3 site key for App Check (public by design; the secret key lives in the Firebase console). */
const RECAPTCHA_V3_SITE_KEY = '6LfRChguAAAAAESR-YSDAFkcJb2gjjap-6Rs20lQ';

export const firebaseApp = initializeApp(firebaseConfig);

// On localhost, App Check prints a debug token to the browser console;
// register it under App Check → Apps → Manage debug tokens.
if (location.hostname === 'localhost') {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// Must run before any Firebase service (AI Logic, Firestore) is used.
export const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
