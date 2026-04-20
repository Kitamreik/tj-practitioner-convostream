import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCB_t3-JUvgWEfyyFmIi7Gh_8Rm6pWuLh0",
  authDomain: "convo-hub-71514.firebaseapp.com",
  projectId: "convo-hub-71514",
  storageBucket: "convo-hub-71514.firebasestorage.app",
  messagingSenderId: "188671429501",
  appId: "1:188671429501:web:6cc334bd11784ccdc79a14",
};

// Reuse the existing FirebaseApp across Vite HMR reloads. Calling
// `initializeApp` twice (or importing this module under two different
// specifiers) creates a second Firestore client that shares the same listen
// channel as the first, which manifests as the "INTERNAL ASSERTION FAILED
// (ID: ca9 / b815) — Unexpected state" crash on watch-stream target changes.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Use `initializeFirestore` with auto-detected long polling. The Lovable
// preview proxy occasionally drops the WebChannel stream mid-flight; auto
// long-polling lets the SDK fall back transparently and prevents the
// duplicate-target-ADD race that triggers the ca9/b815 assertion. Guard
// against double-initialization in the same way as `initializeApp`.
let _db: Firestore;
try {
  _db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  // Already initialized (e.g. via HMR) — reuse the existing instance.
  _db = getFirestore(app);
}
export const db = _db;

// Cloud Functions client — default region us-central1 matches firebase-functions v2.
export const functions = getFunctions(app);
export default app;
