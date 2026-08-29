/**
 * firebase-config.js
 * ------------------
 * Firebase project config. Safe to expose client-side — these values are
 * public identifiers, not secrets. Firestore's real security boundary is
 * Security Rules (configured in the Firebase console), not hiding this.
 * Fill in your actual project's values here.
 */
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
