import { api, ymd } from "./core.js";
import { t as tr, ui } from "./i18n.js";
import { GREETING, shouldSpeak } from "./focus.mjs";

const SPOKEN_KEY = "bench-jarvis-spoken-date";
let mounted = false;
let sessionHidden = false;
let spokeThisLoad = false;

function speak(text) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

export function syncPet(settings = {}) {
  if (window.benchShell?.isDesktop) {
    const host = document.getElementById("jarvis");
    if (host) host.hidden = true;
    return;
  }
  const host = document.getElementById("jarvis");
  if (!host) return;
  if (!mounted) {
    mounted = true;
    host.innerHTML = ui`<button type="button" class="jarvis-orb" data-pet="toggle" aria-label="Jarvis">BEN</button><div class="jarvis-menu" hidden><button type="button" data-pet="home">打开工作台</button><button type="button" data-pet="focus">我的关注</button><button type="button" data-pet="mute">静音今日</button><button type="button" data-pet="close">关闭宠物</button></div>`;
    host.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-pet]")?.dataset.pet;
      if (!action) return;
      if (action === "toggle") {
        const menu = host.querySelector(".jarvis-menu");
        menu.hidden = !menu.hidden;
        return;
      }
      host.querySelector(".jarvis-menu").hidden = true;
      if (action === "home") location.hash = "#home/all";
      if (action === "focus") location.hash = "#reports/pain";
      if (action === "close") {
        sessionHidden = true;
        host.hidden = true;
      }
      if (action === "mute") {
        await api("/api/meta", { method: "PATCH", body: { companion: { mutedDate: ymd() } } });
        document.dispatchEvent(new CustomEvent("bench-reload"));
      }
    });
  }
  const enabled = settings.enabled !== false && !sessionHidden;
  host.hidden = !enabled;
  if (!enabled) return;
  const today = ymd();
  let lastSpoken = "";
  try { lastSpoken = localStorage.getItem(SPOKEN_KEY) || ""; } catch { lastSpoken = ""; }
  if (!spokeThisLoad && shouldSpeak({ settings, today, lastSpokenDate: lastSpoken })) {
    spokeThisLoad = true;
    if (settings.speakMode !== "always") {
      try { localStorage.setItem(SPOKEN_KEY, today); } catch { /* private mode */ }
    }
    speak(GREETING);
  }
}

export function previewGreeting() {
  speak(GREETING);
}
