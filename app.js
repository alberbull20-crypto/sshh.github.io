/* ==========================================================
   SSHH 👻 — app logic
   Two pages share this file: index.html (login) and
   chat.html (everything else). Each block below only runs
   if the matching element exists on the current page.
   ========================================================== */

const ME = sessionStorage.getItem("sshh_username");

/* ---------- helpers ---------- */

function dmChatId(a, b) {
  return [a, b].sort().join("__");
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

/* ==========================================================
   LOGIN PAGE
   ========================================================== */

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  const usernameInput = document.getElementById("username");
  const loginError = document.getElementById("loginError");

  // If already logged in, skip straight to chat
  if (ME) window.location.href = "chat.html";

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim().toLowerCase().replace(/\s+/g, "_");

    if (!name || name.length < 2) {
      loginError.textContent = "give yourself at least 2 characters.";
      return;
    }
    if (!/^[a-z0-9_]+$/.test(name)) {
      loginError.textContent = "letters, numbers, underscores only.";
      return;
    }

    db.ref("users/" + name)
      .set({ lastSeen: Date.now() })
      .then(() => {
        sessionStorage.setItem("sshh_username", name);
        window.location.href = "chat.html";
      })
      .catch((err) => {
        console.error(err);
        loginError.textContent =
          "couldn't connect — check firebase-config.js is filled in.";
      });
  });
}

/* ==========================================================
   CHAT PAGE
   ========================================================== */

const chatList = document.getElementById("chatList");
if (chatList) {
  if (!ME) window.location.href = "index.html";

  document.getElementById("meName").textContent = ME;

  // keep a lightweight presence heartbeat
  db.ref("users/" + ME).update({ lastSeen: Date.now() });
  window.addEventListener("beforeunload", () => {
    db.ref("users/" + ME).update({ lastSeen: Date.now() });
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("sshh_username");
    window.location.href = "index.html";
  });

  /* ---------- notifications ---------- */

  const notifBtn = document.getElementById("notifBtn");
  const NOTIF_ICON =
    document.querySelector('link[rel="icon"]')?.href || undefined;
  const baseTitle = document.title;
  let unreadCount = 0;

  if ("Notification" in window) {
    if (Notification.permission === "default") notifBtn.classList.remove("hidden");
    notifBtn.addEventListener("click", () => {
      Notification.requestPermission().then(() => notifBtn.classList.add("hidden"));
    });
  } else {
    notifBtn.classList.add("hidden");
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      unreadCount = 0;
      document.title = baseTitle;
    }
  });

  function playPing() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    } catch (e) {
      /* ignore — some browsers block audio before any user interaction */
    }
  }

  function notifyNewMessage(chatId, meta) {
    const isViewingThis =
      currentChatId === chatId && document.visibilityState === "visible";
    if (isViewingThis) return;

    playPing();

    if (document.visibilityState === "hidden") {
      unreadCount++;
      document.title = `(${unreadCount}) ${baseTitle}`;
    }

    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(meta.name, {
        body: meta.lastMessage || "new message",
        icon: NOTIF_ICON,
      });
      n.onclick = () => {
        window.focus();
        openChat(chatId, meta.type, meta.name);
        n.close();
      };
    }
  }

  /* ---------- tabs ---------- */

  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = {
    chats: document.getElementById("tabChats"),
    people: document.getElementById("tabPeople"),
  };
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      Object.values(tabPanels).forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      tabPanels[btn.dataset.tab].classList.add("active");
    });
  });

  /* ---------- state ---------- */

  let currentChatId = null;
  let currentChatMeta = null; // { type, name }
  let messagesUnsub = null;

  const emptyState = document.getElementById("emptyState");
  const chatView = document.getElementById("chatView");
  const chatTitle = document.getElementById("chatTitle");
  const chatSubtitle = document.getElementById("chatSubtitle");
  const messagesEl = document.getElementById("messages");

  /* ---------- people list (everyone who ever logged in) ---------- */

  const peopleList = document.getElementById("peopleList");

  db.ref("users").on("value", (snap) => {
    const users = snap.val() || {};
    peopleList.innerHTML = "";
    const others = Object.keys(users).filter((u) => u !== ME).sort();

    if (others.length === 0) {
      peopleList.innerHTML =
        '<li class="list-empty">nobody else has logged in yet. send them the link 👻</li>';
      return;
    }

    others.forEach((username) => {
      const li = document.createElement("li");
      li.className = "list-item";
      li.innerHTML = `
        <div class="avatar">${initials(username)}</div>
        <div class="item-text">
          <div class="item-name">${username}</div>
          <div class="item-sub">tap to whisper</div>
        </div>`;
      li.addEventListener("click", () => openDm(username));
      peopleList.appendChild(li);
    });
  });

  /* ---------- conversations list (chats you're already in) ---------- */

  let prevConvoTs = {};
  let convoListenerInitialized = false;

  db.ref("conversations/" + ME).on("value", (snap) => {
    const convos = snap.val() || {};
    const entries = Object.entries(convos).sort(
      (a, b) => (b[1].lastTs || 0) - (a[1].lastTs || 0)
    );

    // fire notifications for messages that arrived since we last saw this list
    // (skipped on the very first load so old history doesn't all "notify" at once)
    if (convoListenerInitialized) {
      entries.forEach(([chatId, meta]) => {
        const prevTs = prevConvoTs[chatId] || 0;
        const isNew = meta.lastTs && meta.lastTs > prevTs;
        const fromSomeoneElse = meta.lastSender && meta.lastSender !== ME;
        if (isNew && fromSomeoneElse) notifyNewMessage(chatId, meta);
      });
    }
    convoListenerInitialized = true;
    entries.forEach(([chatId, meta]) => {
      prevConvoTs[chatId] = meta.lastTs || 0;
    });

    chatList.innerHTML = "";
    if (entries.length === 0) {
      chatList.innerHTML =
        '<li class="list-empty">no conversations yet — start one from "people".</li>';
      return;
    }

    entries.forEach(([chatId, meta]) => {
      const li = document.createElement("li");
      li.className = "list-item" + (chatId === currentChatId ? " active" : "");
      const isGroup = meta.type === "group";
      li.innerHTML = `
        <div class="avatar ${isGroup ? "group" : ""}">${
        isGroup ? "☍" : initials(meta.name)
      }</div>
        <div class="item-text">
          <div class="item-name">${meta.name}</div>
          <div class="item-sub">${meta.lastMessage || "say hi"}</div>
        </div>`;
      li.addEventListener("click", () =>
        openChat(chatId, meta.type, meta.name)
      );
      chatList.appendChild(li);
    });
  });

  /* ---------- opening a DM (creates the conversation entry if new) ---------- */

  function openDm(otherUser) {
    const chatId = dmChatId(ME, otherUser);
    const meUpdate = {
      ["conversations/" + ME + "/" + chatId]: {
        type: "dm",
        name: otherUser,
        lastMessage: null,
        lastTs: Date.now(),
      },
    };
    const themUpdate = {
      ["conversations/" + otherUser + "/" + chatId]: {
        type: "dm",
        name: ME,
        lastMessage: null,
        lastTs: Date.now(),
      },
    };
    // don't clobber an existing conversation's lastMessage
    db.ref("conversations/" + ME + "/" + chatId).once("value", (snap) => {
      if (!snap.exists()) db.ref().update(meUpdate);
    });
    db.ref("conversations/" + otherUser + "/" + chatId).once("value", (snap) => {
      if (!snap.exists()) db.ref().update(themUpdate);
    });
    openChat(chatId, "dm", otherUser);
  }

  /* ---------- opening any chat (dm or group) ---------- */

  function openChat(chatId, type, name) {
    currentChatId = chatId;
    currentChatMeta = { type, name };

    emptyState.classList.add("hidden");
    chatView.classList.remove("hidden");
    chatTitle.textContent = (type === "group" ? "☍ " : "") + name;
    chatSubtitle.textContent = type === "group" ? "group chat" : "direct whisper";
    document.querySelector(".app").classList.add("chat-open"); // mobile: slide into chat view

    document
      .querySelectorAll("#chatList .list-item")
      .forEach((el) => el.classList.remove("active"));

    if (messagesUnsub) messagesUnsub();
    messagesEl.innerHTML = "";

    const ref = db.ref("messages/" + chatId).limitToLast(200);
    const handler = (snap) => {
      const msgs = snap.val() || {};
      messagesEl.innerHTML = "";
      Object.values(msgs)
        .sort((a, b) => a.ts - b.ts)
        .forEach(renderMessage);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    ref.on("value", handler);
    messagesUnsub = () => ref.off("value", handler);
  }

  // mobile: back button returns to the list without closing the chat
  document.getElementById("backBtn").addEventListener("click", () => {
    document.querySelector(".app").classList.remove("chat-open");
  });

  function renderMessage(msg) {
    const div = document.createElement("div");
    const mine = msg.sender === ME;
    div.className = "msg " + (mine ? "mine" : "theirs");
    div.innerHTML = `
      ${
        !mine && currentChatMeta.type === "group"
          ? `<span class="msg-sender">${msg.sender}</span>`
          : ""
      }
      ${escapeHtml(msg.text)}
      <span class="msg-time">${fmtTime(msg.ts)}</span>`;
    messagesEl.appendChild(div);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /* ---------- sending ---------- */

  document.getElementById("messageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    const ts = Date.now();
    db.ref("messages/" + currentChatId).push({ sender: ME, text, ts });

    // update conversation previews for everyone involved
    const preview = text.length > 40 ? text.slice(0, 40) + "…" : text;
    if (currentChatMeta.type === "dm") {
      const other = currentChatMeta.name;
      db.ref("conversations/" + ME + "/" + currentChatId).update({
        lastMessage: preview,
        lastTs: ts,
        lastSender: ME,
      });
      db.ref("conversations/" + other + "/" + currentChatId).update({
        lastMessage: preview,
        lastTs: ts,
        lastSender: ME,
        type: "dm",
        name: ME,
      });
    } else {
      db.ref("groups/" + currentChatId + "/members").once("value", (snap) => {
        const members = Object.keys(snap.val() || {});
        members.forEach((m) => {
          db.ref("conversations/" + m + "/" + currentChatId).update({
            lastMessage: preview,
            lastTs: ts,
            lastSender: ME,
          });
        });
      });
    }

    input.value = "";
  });

  /* ---------- group creation ---------- */

  const groupModal = document.getElementById("groupModal");
  const groupMemberPicker = document.getElementById("groupMemberPicker");
  const groupNameInput = document.getElementById("groupNameInput");

  document.getElementById("newGroupBtn").addEventListener("click", () => {
    db.ref("users").once("value", (snap) => {
      const users = Object.keys(snap.val() || {}).filter((u) => u !== ME);
      groupMemberPicker.innerHTML = users.length
        ? users
            .map(
              (u) => `
        <label class="member-row">
          <input type="checkbox" value="${u}" />
          ${u}
        </label>`
            )
            .join("")
        : '<p class="list-empty">no one else has joined yet.</p>';
      groupNameInput.value = "";
      groupModal.classList.remove("hidden");
    });
  });

  document
    .getElementById("groupCancelBtn")
    .addEventListener("click", () => groupModal.classList.add("hidden"));

  document.getElementById("groupCreateBtn").addEventListener("click", () => {
    const name = groupNameInput.value.trim();
    const checked = Array.from(
      groupMemberPicker.querySelectorAll("input:checked")
    ).map((cb) => cb.value);

    if (!name) return alert("give the group a name.");
    if (checked.length === 0) return alert("pick at least one other person.");

    const groupId = "group_" + db.ref().push().key;
    const members = {};
    [...checked, ME].forEach((u) => (members[u] = true));

    db.ref("groups/" + groupId).set({
      name,
      members,
      createdBy: ME,
      createdAt: Date.now(),
    });

    Object.keys(members).forEach((u) => {
      db.ref("conversations/" + u + "/" + groupId).set({
        type: "group",
        name,
        lastMessage: "group created",
        lastTs: Date.now(),
      });
    });

    groupModal.classList.add("hidden");
    openChat(groupId, "group", name);
  });
}
