// group-name-locker-fast.js
const login = require("ws3-fca");
const fs = require("fs");
const express = require("express");

// ✅ Load AppState
let appState;
try {
  appState = JSON.parse(fs.readFileSync("appstate.json", "utf-8"));
} catch (err) {
  console.error("❌ Error reading appstate.json:", err);
  process.exit(1);
}

// ✅ Group Info (change these)
const GROUP_THREAD_ID = "25225211533747620";        // Group ka ID
const LOCKED_GROUP_NAME = "L0CK3D BY AXSHU 🩷";     // Locked name

// ✅ Express Server to keep bot alive (for Render or UptimeRobot)
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("🤖 Group Name Locker Bot is alive!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

/**
 * Safe function to set title with logging and simple retry.
 * tries once and logs error; the polling fallback will attempt again soon.
 */
function safeSetTitle(api, title, threadID, cb) {
  api.setTitle(title, threadID, (err) => {
    if (err) {
      console.error(`❌ safeSetTitle failed to set "${title}" on ${threadID}:`, err);
      if (typeof cb === "function") cb(err);
    } else {
      console.log(`🔒 Group title set to "${title}" on ${threadID}`);
      if (typeof cb === "function") cb(null);
    }
  });
}

/**
 * Polling fallback: checks group name every `pollIntervalMs` and resets if needed.
 * We use a relatively short interval (30s) because we want it fast.
 */
function startPollingFallback(api, pollIntervalMs = 30 * 1000) {
  let stopped = false;

  async function loop() {
    if (stopped) return;
    api.getThreadInfo(GROUP_THREAD_ID, (err, info) => {
      if (err) {
        console.error("❌ Polling: error fetching group info:", err);
        // retry after longer wait on error
        return setTimeout(loop, 60 * 1000);
      }

      const currentName = info?.name || info?.threadName || "Unknown";
      if (currentName !== LOCKED_GROUP_NAME) {
        console.warn(`⚠️ Polling detected name change ("${currentName}") → resetting immediately...`);
        // immediate reset (no random delay)
        safeSetTitle(api, LOCKED_GROUP_NAME, GROUP_THREAD_ID, () => {
          // After trying to reset, continue quickly
          setTimeout(loop, 5 * 1000);
        });
      } else {
        // name correct, check again after pollIntervalMs
        setTimeout(loop, pollIntervalMs);
      }
    });
  }
  loop();

  return () => { stopped = true; };
}

/**
 * Event-driven instant reset:
 * Listen to MQTT events from ws3-fca and when we detect a group title-change related event
 * for our target group, we immediately reset the title.
 *
 * Note: different FCA variants use slightly different logMessageType values.
 * We'll catch common variants: 'log:thread-name', 'log:thread-title' and also
 * do a safe substring check if available.
 */
function startEventListener(api) {
  try {
    api.listenMqtt((err, event) => {
      if (err) {
        return console.error("❌ listenMqtt error:", err);
      }

      // Debug print (comment out later if too noisy)
      console.log("Event received:", event?.logMessageType || event?.type, "thread:", event?.threadID);

      // Only interested in 'event' type messages that look like thread name/title changes
      if (event && event.type === "event" && event.logMessageType) {
        const t = event.logMessageType.toString();

        const looksLikeTitleChange =
          t === "log:thread-name" ||
          t === "log:thread-title" ||
          t === "log:thread-name-change" ||
          t.includes("thread") && t.includes("name") ||
          t.includes("thread") && t.includes("title");

        if (looksLikeTitleChange) {
          const threadId = event.threadID || event.logMessageData?.threadID || event.logMessageData?.threadId;
          // Ensure it's our target group
          if (threadId === GROUP_THREAD_ID) {
            console.warn("⚠️ Event-driven: group title change event detected for target group.");

            // Very small delay to let FB internal update settle (200ms)
            setTimeout(() => {
              // Immediately set title back
              safeSetTitle(api, LOCKED_GROUP_NAME, GROUP_THREAD_ID, (err) => {
                if (err) {
                  console.error("❌ Event-driven: failed to reset title (will rely on polling fallback):", err);
                } else {
                  console.log("🔁 Event-driven: reset executed.");
                }
              });
            }, 200);
          } else {
            // not our group — ignore
            // console.log("Event for other group:", threadId);
          }
        }
      }
    });
  } catch (e) {
    console.error("❌ startEventListener crashed:", e);
  }
}

// 🟢 Facebook Login and start both systems (event + polling fallback)
login({ appState }, (err, api) => {
  if (err) {
    console.error("❌ Login Failed:", err);
    return;
  }

  console.log("✅ Logged in successfully. Fast group name locker activated.");

  // Start event-driven instant reset
  startEventListener(api);

  // Start polling fallback (30s interval)
  startPollingFallback(api, 30 * 1000);
});
