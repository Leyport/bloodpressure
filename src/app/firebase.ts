import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAI, GoogleAIBackend } from 'firebase/ai';

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

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
