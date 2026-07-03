import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB_uU_AmvPLtHq1elJLNIHyNE1PT5PJ9K0",
  authDomain: "auth-138a3.firebaseapp.com",
  projectId: "auth-138a3",
  storageBucket: "auth-138a3.firebasestorage.app",
  messagingSenderId: "478369852792",
  appId: "1:478369852792:web:1944215e177e382faeec8d",
  measurementId: "G-P8TTQY2GXP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
