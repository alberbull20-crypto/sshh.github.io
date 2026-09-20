// ============================================================
// Firebase config — SSHH
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAK_gKc5DxG5--85GFHZdf-DqtrnWVqnzA",
  authDomain: "sshh-app.firebaseapp.com",
  databaseURL: "https://sshh-app-default-rtdb.firebaseio.com",
  projectId: "sshh-app",
  storageBucket: "sshh-app.firebasestorage.app",
  messagingSenderId: "614986672743",
  appId: "1:614986672743:web:08a77306dbb904d13e42c2"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();