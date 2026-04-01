import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCB_t3-JUvgWEfyyFmIi7Gh_8Rm6pWuLh0",
  authDomain: "convo-hub-71514.firebaseapp.com",
  projectId: "convo-hub-71514",
  storageBucket: "convo-hub-71514.firebasestorage.app",
  messagingSenderId: "188671429501",
  appId: "1:188671429501:web:6cc334bd11784ccdc79a14",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
