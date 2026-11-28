"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import {
  getAuthMe,
  registerAuthProfile,
  setApiTokenProvider,
  setSyncAuthToken,
  verifyLoginRole,
} from "@/lib/api";
import {
  createGoogleProvider,
  getFirebaseAuth,
  getFirebaseDb,
  isFirebaseConfigured,
} from "@/lib/firebase";
import { UserProfile, UserRole } from "@/types/quakelens";

function mapFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code || "")
      : "";
  switch (code) {
    case "auth/email-already-in-use":
      return "このメールアドレスは既に登録されています。ログイン画面からサインインしてください。";
    case "auth/invalid-email":
      return "メールアドレスの形式が正しくありません。";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "メールアドレスまたはパスワードが正しくありません。";
    case "auth/weak-password":
      return "パスワードは6文字以上（英数字推奨）で入力してください。";
    case "auth/too-many-requests":
      return "認証試行回数が上限に達しました。しばらく待ってから再試行してください。";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Googleログイン画面が閉じられました。";
    case "auth/popup-blocked":
      return "ブラウザによりポップアップがブロックされました。ポップアップを許可してください。";
    case "auth/unauthorized-domain": {
      const currentHost =
        typeof window !== "undefined" ? window.location.hostname : "";
      return currentHost
        ? `現在のアクセス元ドメイン（${currentHost}）が Firebase Authentication の「承認済みドメイン」に許可されていません。http://localhost:3000 または承認済みドメインでアクセスしてください。`
        : "現在のアクセス元ドメインが Firebase Authentication の「承認済みドメイン」に許可されていません。";
    }
    case "auth/operation-not-allowed":
      return "この認証方式は Firebase Console 側で有効化されていません。";
    case "auth/account-exists-with-different-credential":
      return "同じメールアドレスで別の認証方式（メール/パスワード等）が既に登録されています。";
    case "auth/network-request-failed":
      return "ネットワークエラーが発生しました。接続状態を確認してください。";
    default:
      if (err instanceof Error && err.message) {
        return err.message;
      }
      return "認証処理中にエラーが発生しました。";
  }
}

async function syncNonPrivilegedUserDoc(
  user: User,
  profile: UserProfile
): Promise<void> {
  // Strictly mirror only citizen / enterprise metadata from the client;
  // Firestore rules forbid client writes with role == "government" or verifiedAgency == true.
  if (profile.role !== "citizen" && profile.role !== "enterprise") {
    return;
  }
  const db = getFirebaseDb();
  if (!db) return;
  try {
    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        email: profile.email || user.email || "",
        displayName: profile.display_name,
        role: profile.role,
        organizationName: profile.organization_name || "",
        department: profile.department || "",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("Firestore non-privileged user profile sync skipped:", err);
  }
}

async function syncUserDocAndToken(
  user: User,
  profile: UserProfile,
  claimsSynced?: boolean
): Promise<void> {
  if (claimsSynced) {
    try {
      const refreshedToken = await user.getIdToken(true);
      setSyncAuthToken(refreshedToken);
    } catch (err) {
      console.warn("Firebase ID token claim refresh skipped:", err);
    }
  }
  await syncNonPrivilegedUserDoc(user, profile);
}

interface AuthContextValue {
  firebaseReady: boolean;
  firebaseUser: User | null;
  profile: UserProfile | null;
  authLoading: boolean;
  needsRegistration: boolean;
  authError: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  refreshProfile: () => Promise<UserProfile | null>;
  loginWithEmailAndRole: (params: {
    email: string;
    password: string;
    role: UserRole;
  }) => Promise<UserProfile>;
  loginWithGoogleAndRole: (
    role: UserRole
  ) => Promise<
    | { status: "ok"; profile: UserProfile }
    | { status: "needs_registration"; uid: string; email: string; displayName: string }
  >;
  registerWithEmail: (params: {
    email: string;
    password: string;
    displayName: string;
    role: UserRole;
    organizationName?: string;
    department?: string;
    govCode?: string;
  }) => Promise<UserProfile>;
  completeGoogleRegistration: (params: {
    displayName: string;
    role: UserRole;
    organizationName?: string;
    department?: string;
    govCode?: string;
  }) => Promise<UserProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const firebaseReady = isFirebaseConfigured();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(firebaseReady);
  const [authError, setAuthError] = useState<string | null>(null);
  const actionLockRef = useRef(false);

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setApiTokenProvider(async () => {
      const auth = getFirebaseAuth();
      const user = auth?.currentUser;
      if (!user) {
        setSyncAuthToken(null);
        return null;
      }
      const token = await user.getIdToken();
      setSyncAuthToken(token);
      return token;
    });
    const auth = getFirebaseAuth();
    const unsubToken = auth
      ? onIdTokenChanged(auth, async (u) => {
          if (!u) {
            setSyncAuthToken(null);
            return;
          }
          try {
            const t = await u.getIdToken();
            setSyncAuthToken(t);
          } catch {
            setSyncAuthToken(null);
          }
        })
      : undefined;
    return () => {
      unsubToken?.();
      setApiTokenProvider(null);
      setSyncAuthToken(null);
    };
  }, []);

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) {
      setProfile(null);
      return null;
    }
    const token = await user.getIdToken();
    setSyncAuthToken(token);
    const me = await getAuthMe(token);
    if (me.registered && me.user) {
      await syncUserDocAndToken(user, me.user, me.claims_synced);
      setProfile(me.user);
      return me.user;
    }
    setProfile(null);
    return null;
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      queueMicrotask(() => setAuthLoading(false));
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (actionLockRef.current) {
        return;
      }
      if (!user) {
        setProfile(null);
        setAuthError(null);
        setAuthLoading(false);
        return;
      }
      setAuthLoading(true);
      try {
        const token = await user.getIdToken();
        setSyncAuthToken(token);
        const me = await getAuthMe(token);
        if (me.registered && me.user) {
          await syncUserDocAndToken(user, me.user, me.claims_synced);
          setProfile(me.user);
          setAuthError(null);
        } else {
          setProfile(null);
        }
      } catch (err) {
        setProfile(null);
        setAuthError(err instanceof Error ? err.message : "認証状態の検証に失敗しました。");
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const loginWithEmailAndRole = useCallback(
    async (params: { email: string; password: string; role: UserRole }): Promise<UserProfile> => {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase の設定がまだ完了していません。");
      }
      actionLockRef.current = true;
      setAuthError(null);
      try {
        const cred = await signInWithEmailAndPassword(
          auth,
          params.email.trim(),
          params.password
        );
        const token = await cred.user.getIdToken(true);
        setSyncAuthToken(token);
        try {
          const verified = await verifyLoginRole({ role: params.role }, token);
          await syncUserDocAndToken(cred.user, verified.user, verified.claims_synced);
          setFirebaseUser(cred.user);
          setProfile(verified.user);
          return verified.user;
        } catch (err) {
          await signOut(auth).catch(() => {});
          setFirebaseUser(null);
          setProfile(null);
          throw err;
        }
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      } finally {
        actionLockRef.current = false;
        setAuthLoading(false);
      }
    },
    []
  );

  const loginWithGoogleAndRole = useCallback(
    async (
      role: UserRole
    ): Promise<
      | { status: "ok"; profile: UserProfile }
      | { status: "needs_registration"; uid: string; email: string; displayName: string }
    > => {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase の設定がまだ完了していません。");
      }
      actionLockRef.current = true;
      setAuthError(null);
      try {
        const cred = await signInWithPopup(auth, createGoogleProvider());
        const token = await cred.user.getIdToken(true);
        setSyncAuthToken(token);
        const me = await getAuthMe(token);
        if (!me.registered || !me.user) {
          setFirebaseUser(cred.user);
          setProfile(null);
          return {
            status: "needs_registration",
            uid: cred.user.uid,
            email: me.email || cred.user.email || "",
            displayName: cred.user.displayName || "",
          };
        }
        try {
          const verified = await verifyLoginRole({ role }, token);
          await syncUserDocAndToken(
            cred.user,
            verified.user,
            Boolean(me.claims_synced || verified.claims_synced)
          );
          setFirebaseUser(cred.user);
          setProfile(verified.user);
          return { status: "ok", profile: verified.user };
        } catch (err) {
          await signOut(auth).catch(() => {});
          setFirebaseUser(null);
          setProfile(null);
          throw err;
        }
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      } finally {
        actionLockRef.current = false;
        setAuthLoading(false);
      }
    },
    []
  );

  const registerWithEmail = useCallback(
    async (params: {
      email: string;
      password: string;
      displayName: string;
      role: UserRole;
      organizationName?: string;
      department?: string;
      govCode?: string;
    }): Promise<UserProfile> => {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase の設定がまだ完了していません。");
      }
      actionLockRef.current = true;
      setAuthError(null);
      try {
        const cred = await createUserWithEmailAndPassword(
          auth,
          params.email.trim(),
          params.password
        );
        try {
          if (params.displayName.trim()) {
            await updateProfile(cred.user, {
              displayName: params.displayName.trim(),
            }).catch(() => {});
          }
          const token = await cred.user.getIdToken(true);
          setSyncAuthToken(token);
          const registered = await registerAuthProfile(
            {
              role: params.role,
              display_name: params.displayName.trim(),
              organization_name: params.organizationName?.trim() || "",
              department: params.department?.trim() || "",
              gov_code: params.govCode?.trim() || "",
            },
            token
          );
          await syncUserDocAndToken(
            cred.user,
            registered.user,
            registered.claims_synced
          );
          setFirebaseUser(cred.user);
          setProfile(registered.user);
          return registered.user;
        } catch (err) {
          // Roll back newly created Firebase Auth account if backend rejects role/gov code
          try {
            await cred.user.delete();
          } catch {
            await signOut(auth).catch(() => {});
          }
          setFirebaseUser(null);
          setProfile(null);
          throw err;
        }
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      } finally {
        actionLockRef.current = false;
        setAuthLoading(false);
      }
    },
    []
  );

  const completeGoogleRegistration = useCallback(
    async (params: {
      displayName: string;
      role: UserRole;
      organizationName?: string;
      department?: string;
      govCode?: string;
    }): Promise<UserProfile> => {
      const auth = getFirebaseAuth();
      if (!auth) {
        throw new Error("Firebase の設定がまだ完了していません。");
      }
      actionLockRef.current = true;
      setAuthError(null);
      const hadUserBefore = Boolean(auth.currentUser);
      try {
        let user = auth.currentUser;
        if (!user) {
          const cred = await signInWithPopup(auth, createGoogleProvider());
          user = cred.user;
        }
        const token = await user.getIdToken(true);
        setSyncAuthToken(token);
        try {
          const registered = await registerAuthProfile(
            {
              role: params.role,
              display_name:
                params.displayName.trim() || user.displayName || user.email || "登録ユーザー",
              organization_name: params.organizationName?.trim() || "",
              department: params.department?.trim() || "",
              gov_code: params.govCode?.trim() || "",
            },
            token
          );
          await syncUserDocAndToken(user, registered.user, registered.claims_synced);
          setFirebaseUser(user);
          setProfile(registered.user);
          return registered.user;
        } catch (err) {
          const errText = err instanceof Error ? err.message : "";
          if (!hadUserBefore && errText.includes("既に")) {
            await signOut(auth).catch(() => {});
            setFirebaseUser(null);
            setProfile(null);
          }
          throw err;
        }
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      } finally {
        actionLockRef.current = false;
        setAuthLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      await signOut(auth);
    }
    setFirebaseUser(null);
    setProfile(null);
    setAuthError(null);
  }, []);

  const needsRegistration = useMemo(
    () => Boolean(firebaseUser && !profile && !authLoading),
    [firebaseUser, profile, authLoading]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseReady,
      firebaseUser,
      profile,
      authLoading,
      needsRegistration,
      authError,
      getIdToken,
      refreshProfile,
      loginWithEmailAndRole,
      loginWithGoogleAndRole,
      registerWithEmail,
      completeGoogleRegistration,
      logout,
    }),
    [
      firebaseReady,
      firebaseUser,
      profile,
      authLoading,
      needsRegistration,
      authError,
      getIdToken,
      refreshProfile,
      loginWithEmailAndRole,
      loginWithGoogleAndRole,
      registerWithEmail,
      completeGoogleRegistration,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
