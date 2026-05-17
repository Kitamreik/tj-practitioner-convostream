import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";

// Firebase web config — values are publishable, but we read them from
// `import.meta.env` so deploys can swap projects (staging/prod) without a
// code change. `.env.local` ships safe defaults for the dev/preview env;
// production overrides come from Lovable Project Secrets (also VITE_-prefixed).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyCB_t3-JUvgWEfyyFmIi7Gh_8Rm6pWuLh0",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "convo-hub-71514.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "convo-hub-71514",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "convo-hub-71514.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "188671429501",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:188671429501:web:6cc334bd11784ccdc79a14",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// -------- Firebase App Check (reCAPTCHA v3) --------
// Reduces abuse of the public widget, contact form, and callable Cloud
// Functions by attaching an attestation token to every Firebase request.
// Enabled when `VITE_RECAPTCHA_V3_SITE_KEY` is set in the environment;
// otherwise we no-op so local dev / preview deploys keep working before the
// webmaster has registered a site key in Firebase Console → App Check.
//
// Server enforcement: Cloud Functions opt-in via `enforceAppCheck: true` in
// the callable options (see `functions/src/index.ts`).
let _appCheck: AppCheck | null = null;
const RECAPTCHA_V3_SITE_KEY = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined;
if (typeof window !== "undefined" && RECAPTCHA_V3_SITE_KEY) {
  try {
    // Debug token: when running in the Lovable preview or localhost, allow a
    // debug token so engineers can exercise enforced endpoints without a
    // real reCAPTCHA challenge. Set
    // `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` in DevTools to enroll.
    if (
      import.meta.env.DEV &&
      typeof (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN === "undefined"
    ) {
      (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    _appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Most commonly: App Check already initialized via HMR. Safe to ignore.
    console.warn("App Check init skipped:", err);
  }
}
export const appCheck = _appCheck;

let _db: Firestore;
try {
  _db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  _db = getFirestore(app);
}
export const db = _db;

export const functions = getFunctions(app);
export default app;
