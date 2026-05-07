/* ConvoHub embeddable chat widget v1
 * Vanilla JS — no framework dependency. Loads from /widget/v1/convohub-widget.js
 * Reads data-tenant, data-color, data-endpoint from its own <script> tag.
 * Persists session in localStorage key "convohub.widget.session".
 */
(function () {
  if (window.__convohubWidgetLoaded) return;
  window.__convohubWidgetLoaded = true;

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if ((scripts[i].src || "").indexOf("convohub-widget.js") !== -1) return scripts[i];
    }
    return null;
  })();

  var TENANT = (script && script.getAttribute("data-tenant")) || "default";
  var COLOR = (script && script.getAttribute("data-color")) || "#E07A5F";
  var ORIGIN = (script && script.src) ? new URL(script.src).origin : window.location.origin;
  var ENDPOINT = (script && script.getAttribute("data-endpoint")) || ORIGIN;
  var REGION = (script && script.getAttribute("data-region")) || "us-central1";
  // Firebase project id is needed to call HTTPS Cloud Functions directly.
  var PROJECT = (script && script.getAttribute("data-project")) || "convo-hub-71514";
  var FN_BASE = "https://" + REGION + "-" + PROJECT + ".cloudfunctions.net";

  var SESSION_KEY = "convohub.widget.session";
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // Shadow DOM container
  var host = document.createElement("div");
  host.id = "convohub-widget-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;bottom:0;right:0;";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = [
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    ".bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:" + COLOR + ";color:#fff;border:none;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;font-size:24px;transition:transform .15s}",
    ".bubble:hover{transform:scale(1.05)}",
    ".panel{position:fixed;bottom:90px;right:20px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;color:#111}",
    ".panel.open{display:flex}",
    ".header{background:" + COLOR + ";color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}",
    ".header h3{margin:0;font-size:15px;font-weight:600}",
    ".close{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}",
    ".body{flex:1;overflow-y:auto;padding:14px;background:#faf7f4}",
    ".form label{display:block;font-size:12px;color:#444;margin-top:10px;margin-bottom:4px}",
    ".form input,.form textarea{width:100%;padding:8px 10px;font-size:14px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#111}",
    ".form .row{font-size:12px;color:#555;margin-top:12px;display:flex;gap:6px;align-items:flex-start}",
    ".btn{background:" + COLOR + ";color:#fff;border:none;padding:10px 14px;border-radius:8px;cursor:pointer;font-weight:600;width:100%;margin-top:14px;font-size:14px}",
    ".btn:disabled{opacity:.6;cursor:not-allowed}",
    ".msg{max-width:80%;margin:6px 0;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;word-wrap:break-word}",
    ".msg.cust{background:" + COLOR + ";color:#fff;margin-left:auto;border-bottom-right-radius:4px}",
    ".msg.agent{background:#fff;border:1px solid #eee;color:#222;margin-right:auto;border-bottom-left-radius:4px}",
    ".msg.sys{background:transparent;color:#888;font-size:12px;text-align:center;margin:8px auto}",
    ".composer{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}",
    ".composer input{flex:1;padding:9px 12px;border:1px solid #ddd;border-radius:20px;font-size:14px;background:#fff;color:#111}",
    ".composer button{background:" + COLOR + ";color:#fff;border:none;padding:8px 14px;border-radius:20px;cursor:pointer;font-weight:600}",
    ".foot{padding:6px 12px;font-size:10px;color:#999;text-align:center;background:#fff;border-top:1px solid #eee}",
    ".foot a{color:#666;text-decoration:underline}",
    ".err{color:#b00020;font-size:12px;margin-top:8px}",
  ].join("");
  root.appendChild(style);

  var bubble = document.createElement("button");
  bubble.className = "bubble"; bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML = "&#128172;";
  root.appendChild(bubble);

  var panel = document.createElement("div");
  panel.className = "panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat with us");
  root.appendChild(panel);

  function render() {
    var session = loadSession();
    panel.innerHTML = "";
    var header = document.createElement("div");
    header.className = "header";
    header.innerHTML = "<h3>Chat with us</h3>";
    var close = document.createElement("button");
    close.className = "close"; close.innerHTML = "&times;"; close.setAttribute("aria-label", "Close");
    close.onclick = function () { panel.classList.remove("open"); };
    header.appendChild(close);
    panel.appendChild(header);

    var body = document.createElement("div");
    body.className = "body";
    panel.appendChild(body);

    var foot = document.createElement("div");
    foot.className = "foot";
    foot.innerHTML = 'By chatting you accept our <a href="' + ORIGIN + '/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.';
    panel.appendChild(foot);

    if (!session || !session.conversationId) {
      renderForm(body);
    } else {
      renderThread(body, session);
    }
  }

  function renderForm(body) {
    var form = document.createElement("form");
    form.className = "form";
    form.innerHTML = '' +
      '<p style="margin:0 0 8px;font-size:13px;color:#444">Hi! Tell us a bit about yourself and we\'ll get right back to you.</p>' +
      '<label>Your name</label><input name="name" required maxlength="80" />' +
      '<label>Email</label><input name="email" type="email" required maxlength="254" />' +
      '<label>Phone (optional)</label><input name="phone" type="tel" maxlength="32" />' +
      '<div class="row"><input type="checkbox" name="consent" id="cv-consent" required style="width:auto;margin-top:3px" />' +
      '<label for="cv-consent" style="margin:0">I agree to the <a href="' + ORIGIN + '/legal/terms" target="_blank" rel="noopener">Terms</a> and <a href="' + ORIGIN + '/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</label></div>' +
      '<button type="submit" class="btn">Start chat</button>' +
      '<p class="err" id="cv-err" style="display:none"></p>';
    body.appendChild(form);
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = form.querySelector("button");
      var err = form.querySelector("#cv-err");
      btn.disabled = true; btn.textContent = "Connecting…"; err.style.display = "none";
      var fd = new FormData(form);
      fetch(FN_BASE + "/createWidgetConversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: TENANT,
          name: fd.get("name"),
          email: fd.get("email"),
          phone: fd.get("phone") || "",
          consent: fd.get("consent") === "on",
          pageUrl: location.href,
        }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.ok) throw new Error(res.j.message || "Could not start chat.");
          saveSession({
            conversationId: res.j.conversationId,
            visitorId: res.j.visitorId,
            visitorToken: res.j.visitorToken,
            name: fd.get("name"),
            email: fd.get("email"),
          });
          render();
        })
        .catch(function (e2) {
          err.textContent = e2.message || "Connection failed."; err.style.display = "block";
          btn.disabled = false; btn.textContent = "Start chat";
        });
    };
  }

  var pollTimer = null;
  function renderThread(body, session) {
    var list = document.createElement("div");
    body.appendChild(list);
    var composer = document.createElement("form");
    composer.className = "composer";
    composer.innerHTML = '<input name="msg" placeholder="Type a message…" maxlength="2000" autocomplete="off" required /><button type="submit">Send</button>';
    panel.insertBefore(composer, panel.querySelector(".foot"));

    var seen = {};
    function fetchMessages() {
      // Poll the conversation messages via a public read endpoint? We don't have
      // one — so we poll the same Firestore REST API for that conversation's
      // messages subcollection. Public reads are blocked by rules, so the
      // widget instead polls a thin "list messages by visitor token" endpoint.
      // For v1 we fetch our own writes optimistically and rely on agents
      // writing replies to the same subcollection; we surface them via a
      // lightweight `getWidgetMessages` REST proxy if available, falling back
      // to optimistic-only display.
      fetch(FN_BASE + "/getWidgetMessages?conversationId=" + encodeURIComponent(session.conversationId) + "&visitorToken=" + encodeURIComponent(session.visitorToken))
        .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
        .then(function (j) {
          (j.messages || []).forEach(function (m) {
            if (seen[m.id]) return;
            seen[m.id] = true;
            appendMsg(m.sender === "customer" ? "cust" : "agent", m.body);
          });
        })
        .catch(function () {});
    }
    function appendMsg(cls, text) {
      var d = document.createElement("div");
      d.className = "msg " + cls;
      d.textContent = text;
      list.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }
    appendMsg("sys", "Connected. We'll reply here as soon as possible.");
    fetchMessages();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchMessages, 4000);

    composer.onsubmit = function (e) {
      e.preventDefault();
      var input = composer.querySelector("input");
      var text = (input.value || "").trim();
      if (!text) return;
      input.value = "";
      var optimisticId = "local-" + Date.now();
      seen[optimisticId] = true;
      appendMsg("cust", text);
      fetch(FN_BASE + "/postWidgetMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: session.conversationId,
          visitorToken: session.visitorToken,
          body: text,
        }),
      }).then(function (r) {
        if (r.status === 403 || r.status === 404) {
          clearSession();
          alert("Chat session expired. Please start a new conversation.");
          panel.classList.remove("open");
          render();
        }
      });
    };
  }

  bubble.onclick = function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && !panel.firstChild) render();
    if (panel.classList.contains("open") && panel.firstChild === null) render();
  };
  // Pre-render so opening is instant.
  render();
})();
