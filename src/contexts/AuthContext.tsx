import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import {
  doc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { listLocalAgents, removeLocalAgent } from "@/lib/localAgents";

export type UserRole = "agent" | "admin" | "webmaster";

interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  createdAt: Date;
  /** Set by webmasters; grants an admin temporary access to advanced pages. */
  escalatedAccess?: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

async function logLoginAttempt(email: string, success: boolean, uid?: string) {
  try {
    await addDoc(collection(db, "login_attempts"), {
      email,
      success,
      uid: uid || null,
      timestamp: serverTimestamp(),
      userAgent: navigator.userAgent,
    });
  } catch (e) {
    console.error("Failed to log login attempt:", e);
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let profileUnsub: (() => void) | null = null;
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }
      if (firebaseUser) {
        // Real-time subscription so role/escalatedAccess changes (e.g. webmaster
        // promoting an admin) propagate immediately without a re-login.
        profileUnsub = onSnapshot(
          doc(db, "users", firebaseUser.uid),
          async (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
              setLoading(false);
              return;
            }
            // Self-heal: legacy accounts that exist in Firebase Auth but were
            // never written to Firestore (e.g. created before signUp persisted
            // the profile doc). Create a baseline `agent` profile so the user
            // shows up in the Accounts/Agents lists and can be a Reassign
            // target. Webmasters are re-promoted out-of-band via the
            // `promoteToWebmaster` callable. Rules permit self-create with
            // role `agent`.
            try {
              const fallback: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email ?? "",
                role: "agent",
                displayName:
                  firebaseUser.displayName?.trim() ||
                  (firebaseUser.email ? firebaseUser.email.split("@")[0] : "Unnamed user"),
                createdAt: new Date(),
              };
              await setDoc(doc(db, "users", firebaseUser.uid), {
                ...fallback,
                createdAt: serverTimestamp(),
              });
              setProfile(fallback);
            } catch (e) {
              console.error("Self-heal failed to create users/{uid} doc:", e);
              setProfile(null);
            } finally {
              setLoading(false);
            }
          },
          (err) => {
            console.error("Failed to subscribe to user profile:", err);
            setProfile(null);
            setLoading(false);
          }
        );
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      if (profileUnsub) profileUnsub();
      unsub();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await logLoginAttempt(email, true, cred.user.uid);
    } catch (error) {
      await logLoginAttempt(email, false);
      throw error;
    }
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // SECURITY: Role is NEVER accepted from the client. New accounts always get the
    // baseline "agent" role (no access to webmaster-gated routes like /audit, and
    // no access to escalated routes — Integrations / Analytics / Gmail API).
    // Privileged roles must be granted out-of-band by an existing webmaster via a
    // server-side Cloud Function (`promoteToWebmaster`) with proper authorization.
    const profileData: UserProfile = {
      uid: cred.user.uid,
      email,
      role: "agent",
      displayName,
      createdAt: new Date(),
    };
    await setDoc(doc(db, "users", cred.user.uid), profileData);
    setProfile(profileData);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
