import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Placeholder Firebase configuration. User can replace this with their actual keys.
const firebaseConfig = {
  apiKey: "AIzaSyB0rBRHNFfYJ6QdODFG83gRFLtZ0VHvAv0",
  authDomain: "skulk-45c23.firebaseapp.com",
  projectId: "skulk-45c23",
  storageBucket: "skulk-45c23.firebasestorage.app",
  messagingSenderId: "57978390139",
  appId: "1:57978390139:web:bea7167e8cecb4f3aa44de"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

export { signInWithPopup, signOut };