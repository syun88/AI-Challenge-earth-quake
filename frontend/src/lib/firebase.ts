import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  Auth,
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";
import {
  Firestore,
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

function getFirebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "";
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "";
  const messagingSenderId =
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || "";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || "";

  if (USE_EMULATOR) {
    return {
      apiKey: apiKey || "demo-quakelens-api-key",
      authDomain: authDomain || "demo-quakelens.firebaseapp.com",
      projectId: projectId || "demo-quakelens",
      storageBucket: storageBucket || "demo-quakelens.appspot.com",
      messagingSenderId: messagingSenderId || "000000000000",
      appId: appId || "1:000000000000:web:demo",
    };
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

export function isFirebaseConfigured(): boolean {
  if (USE_EMULATOR) return true;
  const cfg = getFirebaseConfig();
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId);
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
  }
  return cachedApp;
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!cachedAuth) {
    cachedAuth = getAuth(app);
  }
  if (USE_EMULATOR && !authEmulatorConnected && typeof window !== "undefined") {
    try {
      connectAuthEmulator(cachedAuth, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
      authEmulatorConnected = true;
    } catch {
      authEmulatorConnected = true;
    }
  }
  return cachedAuth;
}

export function getFirebaseDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!cachedDb) {
    cachedDb = getFirestore(app);
  }
  if (USE_EMULATOR && !firestoreEmulatorConnected && typeof window !== "undefined") {
    try {
      connectFirestoreEmulator(cachedDb, "127.0.0.1", 8080);
      firestoreEmulatorConnected = true;
    } catch {
      firestoreEmulatorConnected = true;
    }
  }
  return cachedDb;
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export const ROLE_META = {
  citizen: {
    id: "citizen" as const,
    label: "一般市民",
    shortLabel: "市民",
    subtitle: "避難場所・ハザード確認・災害通報・安否登録",
    badgeClass: "bg-sky-500/20 text-sky-200 border-sky-400/40",
  },
  enterprise: {
    id: "enterprise" as const,
    label: "企業",
    shortLabel: "企業",
    subtitle: "BCP拠点安全診断・非公開サーバー拠点保護・迂回経路",
    badgeClass: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
  },
  government: {
    id: "government" as const,
    label: "政府関連機関",
    shortLabel: "政府機関",
    subtitle: "全件被害通報閲覧・救助出動ルート・真偽検証・統計出力",
    badgeClass: "bg-amber-500/20 text-amber-200 border-amber-400/40",
  },
};
