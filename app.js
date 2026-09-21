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

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function linkify(escapedText) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  return escapedText.replace(
    urlRegex,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
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

  /* ---------- state ---------- */

  let currentChatId = null;
  let currentChatMeta = null; // { type, name }
  let messagesUnsub = null;
  let typingUnsub = null;
  let typingTimeout = null;
  let readsUnsub = null;
  let lastOtherReadTs = 0;
  let replyingTo = null; // { sender, text }
  let searchQuery = "";

  const emptyState = document.getElementById("emptyState");
  const chatView = document.getElementById("chatView");
  const chatTitle = document.getElementById("chatTitle");
  const chatSubtitle = document.getElementById("chatSubtitle");
  const messagesEl = document.getElementById("messages");
  const manageGroupBtn = document.getElementById("manageGroupBtn");
  const typingIndicator = document.getElementById("typingIndicator");
  const messageInput = document.getElementById("messageInput");
  const charCounter = document.getElementById("charCounter");
  const searchToggleBtn = document.getElementById("searchToggleBtn");
  const searchBar = document.getElementById("searchBar");
  const searchInput = document.getElementById("searchInput");
  const searchCloseBtn = document.getElementById("searchCloseBtn");
  const replyPreview = document.getElementById("replyPreview");
  const replyPreviewSender = document.getElementById("replyPreviewSender");
  const replyPreviewText = document.getElementById("replyPreviewText");
  const replyCancelBtn = document.getElementById("replyCancelBtn");
  const emojiRow = document.getElementById("emojiRow");
  const emojiToggleBtn = document.getElementById("emojiToggleBtn");

  // keep a lightweight presence heartbeat
  db.ref("users/" + ME).update({ lastSeen: Date.now() });
  window.addEventListener("beforeunload", () => {
    db.ref("users/" + ME).update({ lastSeen: Date.now() });
    if (currentChatId) db.ref("typing/" + currentChatId + "/" + ME).remove();
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("sshh_username");
    window.location.href = "index.html";
  });

  /* ---------- notifications ---------- */

  const notifBtn = document.getElementById("notifBtn");
  const NOTIF_ICON = document.querySelector('link[rel="icon"]')?.href || undefined;
  const baseTitle = document.title;
  let unreadTitleCount = 0;

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
      unreadTitleCount = 0;
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
      unreadTitleCount++;
      document.title = `(${unreadTitleCount}) ${baseTitle}`;
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
      const unread = meta.unread || 0;
      li.innerHTML = `
        <div class="avatar ${isGroup ? "group" : ""}">${
        isGroup ? "☍" : initials(meta.name)
      }</div>
        <div class="item-text">
          <div class="item-name ${unread ? "unread" : ""}">${meta.name}</div>
          <div class="item-sub">${meta.lastMessage || "say hi"}</div>
        </div>
        ${unread ? `<span class="item-badge">${unread}</span>` : ""}`;
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
        unread: 0,
      },
    };
    const themUpdate = {
      ["conversations/" + otherUser + "/" + chatId]: {
        type: "dm",
        name: ME,
        lastMessage: null,
        lastTs: Date.now(),
        unread: 0,
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

    manageGroupBtn.classList.toggle("hidden", type !== "group");

    // reset per-chat UI state
    replyingTo = null;
    showReplyPreview();
    searchQuery = "";
    searchInput.value = "";
    searchBar.classList.add("hidden");
    emojiRow.classList.add("hidden");

    // this chat is now open, so its unread count clears
    db.ref("conversations/" + ME + "/" + chatId + "/unread").set(0);

    document
      .querySelectorAll("#chatList .list-item")
      .forEach((el) => el.classList.remove("active"));

    if (messagesUnsub) messagesUnsub();
    messagesEl.innerHTML = "";

    const ref = db.ref("messages/" + chatId).limitToLast(200);
    const handler = (snap) => {
      const msgs = snap.val() || {};
      const list = Object.entries(msgs)
        .map(([key, m]) => ({ key, ...m }))
        .sort((a, b) => a.ts - b.ts);

      messagesEl.innerHTML = "";
      let lastDay = null;
      list.forEach((m) => {
        const label = dayLabel(m.ts);
        if (label !== lastDay) {
          const div = document.createElement("div");
          div.className = "date-divider";
          div.textContent = label;
          messagesEl.appendChild(div);
          lastDay = label;
        }
        renderMessage(m, chatId);
      });
      applySearchFilter();
      applySeenIndicator();
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // viewing this chat marks it read, for the other side's seen receipt
      if (type === "dm") markRead(chatId);
    };
    ref.on("value", handler);
    messagesUnsub = () => ref.off("value", handler);

    listenTyping(chatId);
    listenReads(chatId, type, name);
  }

  // mobile: back button returns to the list without closing the chat
  document.getElementById("backBtn").addEventListener("click", () => {
    document.querySelector(".app").classList.remove("chat-open");
  });

  function renderMessage(msg, chatId) {
    const div = document.createElement("div");
    const mine = msg.sender === ME;
    div.className = "msg " + (mine ? "mine" : "theirs");
    div.dataset.text = msg.text.toLowerCase();
    div.dataset.ts = msg.ts;

    div.innerHTML = `
      ${mine ? `<button class="msg-delete" title="delete">✕</button>` : ""}
      ${
        !mine && currentChatMeta.type === "group"
          ? `<span class="msg-sender">${msg.sender}</span>`
          : ""
      }
      ${
        msg.replyTo
          ? `<div class="msg-quote"><b>${escapeHtml(msg.replyTo.sender)}</b>: ${escapeHtml(
              msg.replyTo.text
            ).slice(0, 80)}</div>`
          : ""
      }
      ${linkify(escapeHtml(msg.text))}
      <span class="msg-time">${fmtTime(msg.ts)}</span>`;

    if (mine) {
      div.querySelector(".msg-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("delete this message?")) {
          db.ref("messages/" + chatId + "/" + msg.key).remove();
        }
      });
    }

    // tap a message to quote it in your reply — but not when tapping a link or the delete button
    div.addEventListener("click", (e) => {
      if (e.target.tagName === "A" || e.target.classList.contains("msg-delete")) return;
      replyingTo = { sender: msg.sender, text: msg.text };
      showReplyPreview();
    });

    messagesEl.appendChild(div);
  }

  /* ---------- message search ---------- */

  searchToggleBtn.addEventListener("click", () => {
    searchBar.classList.toggle("hidden");
    if (!searchBar.classList.contains("hidden")) searchInput.focus();
  });

  searchCloseBtn.addEventListener("click", () => {
    searchBar.classList.add("hidden");
    searchInput.value = "";
    searchQuery = "";
    applySearchFilter();
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applySearchFilter();
  });

  function applySearchFilter() {
    messagesEl.querySelectorAll(".msg").forEach((el) => {
      const text = el.dataset.text || "";
      el.style.display = !searchQuery || text.includes(searchQuery) ? "" : "none";
    });
    messagesEl.querySelectorAll(".date-divider").forEach((el) => {
      el.style.display = searchQuery ? "none" : "";
    });
  }

  /* ---------- seen receipts (DMs only) ---------- */

  function markRead(chatId) {
    db.ref("reads/" + chatId + "/" + ME).set(Date.now());
  }

  function listenReads(chatId, type, otherName) {
    if (readsUnsub) readsUnsub();
    readsUnsub = null;
    lastOtherReadTs = 0;
    if (type !== "dm") return;

    const ref = db.ref("reads/" + chatId + "/" + otherName);
    const handler = (snap) => {
      lastOtherReadTs = snap.val() || 0;
      applySeenIndicator();
    };
    ref.on("value", handler);
    readsUnsub = () => ref.off("value", handler);
  }

  function applySeenIndicator() {
    if (currentChatMeta?.type !== "dm") return;
    messagesEl.querySelectorAll(".msg-seen").forEach((el) => el.remove());
    const mineEls = messagesEl.querySelectorAll(".msg.mine");
    if (mineEls.length === 0) return;
    const lastMine = mineEls[mineEls.length - 1];
    const ts = Number(lastMine.dataset.ts || 0);
    if (ts > 0 && lastOtherReadTs >= ts) {
      const span = document.createElement("span");
      span.className = "msg-seen";
      span.textContent = "✓ seen";
      lastMine.querySelector(".msg-time").after(span);
    }
  }

  /* ---------- reply-to preview ---------- */

  function showReplyPreview() {
    if (!replyingTo) {
      replyPreview.classList.add("hidden");
      return;
    }
    replyPreviewSender.textContent = replyingTo.sender + ": ";
    replyPreviewText.textContent =
      replyingTo.text.length > 60 ? replyingTo.text.slice(0, 60) + "…" : replyingTo.text;
    replyPreview.classList.remove("hidden");
    messageInput.focus();
  }

  replyCancelBtn.addEventListener("click", () => {
    replyingTo = null;
    showReplyPreview();
  });

  /* ---------- emoji picker ---------- */

  const EMOJIS = ["😀", "😂", "😍", "😢", "😮", "🙏", "🔥", "🎉", "👍", "👀", "😅", "😭", "💀", "🤔", "❤️", "👻"];
  emojiRow.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
  emojiRow.querySelectorAll("button").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      messageInput.value += EMOJIS[i];
      messageInput.dispatchEvent(new Event("input"));
      messageInput.focus();
    });
  });
  emojiToggleBtn.addEventListener("click", () => emojiRow.classList.toggle("hidden"));

  /* ---------- character counter ---------- */

  messageInput.addEventListener("input", () => {
    const remaining = 1000 - messageInput.value.length;
    if (remaining <= 100) {
      charCounter.textContent = `${remaining} left`;
      charCounter.classList.remove("hidden");
    } else {
      charCounter.classList.add("hidden");
    }
  });

  /* ---------- unread badges: bump the other side's counter ---------- */

  function bumpUnread(username, chatId) {
    db.ref("conversations/" + username + "/" + chatId + "/unread").transaction(
      (cur) => (cur || 0) + 1
    );
  }

  /* ---------- sending ---------- */

  document.getElementById("messageForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;

    const ts = Date.now();
    const payload = { sender: ME, text, ts };
    if (replyingTo) payload.replyTo = { sender: replyingTo.sender, text: replyingTo.text };

    db.ref("messages/" + currentChatId).push(payload);
    clearTyping();
    replyingTo = null;
    showReplyPreview();

    // update conversation previews + unread counters for everyone involved
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
      bumpUnread(other, currentChatId);
    } else {
      db.ref("groups/" + currentChatId + "/members").once("value", (snap) => {
        const members = Object.keys(snap.val() || {});
        members.forEach((m) => {
          db.ref("conversations/" + m + "/" + currentChatId).update({
            lastMessage: preview,
            lastTs: ts,
            lastSender: ME,
          });
          if (m !== ME) bumpUnread(m, currentChatId);
        });
      });
    }

    messageInput.value = "";
    charCounter.classList.add("hidden");
  });

  /* ---------- typing indicator ---------- */

  function clearTyping() {
    clearTimeout(typingTimeout);
    if (currentChatId) db.ref("typing/" + currentChatId + "/" + ME).remove();
  }

  messageInput.addEventListener("input", () => {
    if (!currentChatId) return;
    db.ref("typing/" + currentChatId + "/" + ME).set(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(clearTyping, 2500);
  });

  function listenTyping(chatId) {
    if (typingUnsub) typingUnsub();
    typingIndicator.classList.add("hidden");
    typingIndicator.textContent = "";

    const ref = db.ref("typing/" + chatId);
    const handler = (snap) => {
      const typing = snap.val() || {};
      const others = Object.keys(typing).filter((u) => u !== ME && typing[u]);
      if (others.length === 0) {
        typingIndicator.classList.add("hidden");
        typingIndicator.textContent = "";
      } else {
        typingIndicator.classList.remove("hidden");
        typingIndicator.textContent =
          others.length === 1
            ? `${others[0]} is typing…`
            : `${others.join(", ")} are typing…`;
      }
    };
    ref.on("value", handler);
    typingUnsub = () => ref.off("value", handler);
  }

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
        lastMessage: "case created",
        lastTs: Date.now(),
        unread: 0,
      });
    });

    groupModal.classList.add("hidden");
    openChat(groupId, "group", name);
  });

  /* ---------- manage group: view members, add, remove (creator only), leave ---------- */

  const manageModal = document.getElementById("manageModal");
  const manageModalTitle = document.getElementById("manageModalTitle");
  const manageMemberList = document.getElementById("manageMemberList");
  const addMemberPicker = document.getElementById("addMemberPicker");
  const addMembersBtn = document.getElementById("addMembersBtn");
  const leaveGroupBtn = document.getElementById("leaveGroupBtn");

  function renderManageModal(groupId) {
    db.ref("groups/" + groupId).once("value", (snap) => {
      const group = snap.val();
      if (!group) return;
      manageModalTitle.textContent = group.name + " — members";
      const members = Object.keys(group.members || {});
      const iAmCreator = group.createdBy === ME;

      manageMemberList.innerHTML = members
        .map((u) => {
          const canRemove = iAmCreator && u !== ME;
          return `
        <div class="member-row">
          <span>${u}${u === group.createdBy ? " (creator)" : ""}</span>
          ${canRemove ? `<button class="member-row-remove" data-user="${u}">remove</button>` : ""}
        </div>`;
        })
        .join("");

      manageMemberList.querySelectorAll(".member-row-remove").forEach((btn) => {
        btn.addEventListener("click", () => {
          const user = btn.dataset.user;
          if (!confirm(`remove ${user} from this case?`)) return;
          db.ref("groups/" + groupId + "/members/" + user).remove();
          db.ref("conversations/" + user + "/" + groupId).remove();
          renderManageModal(groupId); // refresh in place
        });
      });

      // who's not in the group yet, to offer adding them
      db.ref("users").once("value", (usnap) => {
        const allUsers = Object.keys(usnap.val() || {});
        const nonMembers = allUsers.filter((u) => !group.members[u]);
        addMemberPicker.innerHTML = nonMembers.length
          ? nonMembers
              .map(
                (u) => `
          <label class="member-row">
            <input type="checkbox" value="${u}" />
            ${u}
          </label>`
              )
              .join("")
          : '<p class="list-empty">everyone\u2019s already in.</p>';
      });
    });
  }

  addMembersBtn.addEventListener("click", () => {
    if (!currentChatId) return;
    const checked = Array.from(
      addMemberPicker.querySelectorAll("input:checked")
    ).map((cb) => cb.value);
    if (checked.length === 0) return;

    const groupId = currentChatId;
    db.ref("groups/" + groupId + "/name").once("value", (snap) => {
      const groupName = snap.val();
      checked.forEach((u) => {
        db.ref("groups/" + groupId + "/members/" + u).set(true);
        db.ref("conversations/" + u + "/" + groupId).set({
          type: "group",
          name: groupName,
          lastMessage: "added to the case",
          lastTs: Date.now(),
          unread: 0,
        });
      });
      renderManageModal(groupId);
    });
  });

  manageGroupBtn.addEventListener("click", () => {
    if (!currentChatId || currentChatMeta.type !== "group") return;
    renderManageModal(currentChatId);
    manageModal.classList.remove("hidden");
  });

  document
    .getElementById("manageCancelBtn")
    .addEventListener("click", () => manageModal.classList.add("hidden"));

  leaveGroupBtn.addEventListener("click", () => {
    if (!currentChatId) return;
    if (!confirm("leave this case? you'll need to be re-added to come back.")) return;

    const groupId = currentChatId;
    db.ref("groups/" + groupId + "/members/" + ME).remove();
    db.ref("conversations/" + ME + "/" + groupId).remove();

    manageModal.classList.add("hidden");
    chatView.classList.add("hidden");
    emptyState.classList.remove("hidden");
    document.querySelector(".app").classList.remove("chat-open");
    currentChatId = null;
    currentChatMeta = null;
  });
}
