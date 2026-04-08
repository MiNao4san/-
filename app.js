const STORAGE_KEY = "sneeze_classifier_v1";
const MAX_AUDIO_HISTORY_COUNT = 10;

// 初版ではモデル未設定想定。準備できたら true に変更して classifyAudio を実装する。
const MODEL_CONFIGURED = false;

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  modelStatus: document.getElementById("model-status"),
  micPermission: document.getElementById("mic-permission"),
  appState: document.getElementById("app-state"),
  startBtn: document.getElementById("record-start"),
  stopBtn: document.getElementById("record-stop"),
  recordingIndicator: document.getElementById("recording-indicator"),
  resultText: document.getElementById("result-text"),
  saveAudioToggle: document.getElementById("save-audio-toggle"),
  message: document.getElementById("message"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  deleteAllBtn: document.getElementById("delete-all"),
};

let appData = loadData();
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let currentState = "待機中";

init();

function init() {
  setupTabs();
  setupEvents();
  syncSettings();
  syncModelStatus();
  renderHistory();
  checkBrowserSupport();
}

function setupTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      els.tabs.forEach((t) => t.classList.toggle("active", t === tab));
      els.views.forEach((view) => {
        view.classList.toggle("active", view.id === target);
      });
    });
  });
}

function setupEvents() {
  els.startBtn.addEventListener("click", startRecording);
  els.stopBtn.addEventListener("click", stopRecording);
  els.deleteAllBtn.addEventListener("click", deleteAllHistory);

  els.saveAudioToggle.addEventListener("change", () => {
    appData.settings.saveAudio = els.saveAudioToggle.checked;
    persistData();
    showMessage(
      appData.settings.saveAudio
        ? "音声保存: ON（容量上限に注意）"
        : "音声保存: OFF",
      "success"
    );
  });
}

function syncSettings() {
  els.saveAudioToggle.checked = appData.settings.saveAudio;
}

function syncModelStatus() {
  if (MODEL_CONFIGURED) {
    els.modelStatus.textContent = "利用可能";
    return;
  }

  els.modelStatus.textContent = "モデル未設定（準備中）";
  els.startBtn.disabled = true;
  els.stopBtn.disabled = true;
  setState("モデル未設定");
  showMessage("現在モデル未設定のため、判定機能は準備中です。", "error");
}

function checkBrowserSupport() {
  const supported =
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window.MediaRecorder !== "undefined";

  if (!supported) {
    els.startBtn.disabled = true;
    els.stopBtn.disabled = true;
    setState("エラー");
    showMessage("このブラウザは録音機能に対応していません。", "error");
  }
}

async function startRecording() {
  if (!MODEL_CONFIGURED) {
    showMessage("モデル未設定のため録音を開始できません。", "error");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    els.micPermission.textContent = "許可";
    mediaRecorder = new MediaRecorder(mediaStream);
    chunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", onRecordingStopped);

    mediaRecorder.start();
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.recordingIndicator.classList.remove("hidden");
    setState("録音中");
    showMessage("録音を開始しました。", "success");
  } catch (error) {
    console.error(error);
    els.micPermission.textContent = "拒否/失敗";
    setState("エラー");
    showMessage("マイク権限が拒否されたか、録音開始に失敗しました。", "error");
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    return;
  }

  mediaRecorder.stop();
  els.stopBtn.disabled = true;
  els.recordingIndicator.classList.add("hidden");
  setState("判定中");
}

async function onRecordingStopped() {
  try {
    const audioBlob = new Blob(chunks, { type: "audio/webm" });
    const result = await classifyAudio(audioBlob);
    els.resultText.textContent = result === "ojisan" ? "おじさん寄り" : "上品寄り";
    setState("判定完了");
    showMessage("判定が完了しました。", "success");

    const historyItem = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      result,
      audioSaved: appData.settings.saveAudio,
    };

    if (appData.settings.saveAudio) {
      const audioCount = appData.history.filter((item) => item.audioSaved).length;
      if (audioCount >= MAX_AUDIO_HISTORY_COUNT) {
        historyItem.audioSaved = false;
        showMessage(
          `音声保存上限（${MAX_AUDIO_HISTORY_COUNT}件）に達したため、今回の音声は保存されませんでした。`,
          "error"
        );
      } else {
        historyItem.audioData = await blobToBase64(audioBlob);
      }
    }

    appData.history.unshift(historyItem);
    persistData();
    renderHistory();
  } catch (error) {
    console.error(error);
    setState("エラー");
    showMessage("モデル推論に失敗しました。", "error");
  } finally {
    cleanupMediaResources();
    els.startBtn.disabled = false;
  }
}

async function classifyAudio(_audioBlob) {
  if (!MODEL_CONFIGURED) {
    throw new Error("model not configured");
  }

  // TODO: 実モデル導入後に置き換える
  return "ojisan";
}

function deleteHistoryItem(id) {
  appData.history = appData.history.filter((item) => item.id !== id);
  persistData();
  renderHistory();
  showMessage("履歴を削除しました。", "success");
}

function deleteAllHistory() {
  if (appData.history.length === 0) {
    return;
  }
  appData.history = [];
  persistData();
  renderHistory();
  showMessage("履歴を全件削除しました。", "success");
}

function renderHistory() {
  els.historyList.innerHTML = "";

  if (appData.history.length === 0) {
    els.historyEmpty.classList.remove("hidden");
    return;
  }

  els.historyEmpty.classList.add("hidden");

  appData.history.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";

    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = `${formatDate(item.timestamp)} / ${
      item.result === "ojisan" ? "おじさん寄り" : "上品寄り"
    } / 音声保存:${item.audioSaved ? "あり" : "なし"}`;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    if (item.audioSaved && item.audioData) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = item.audioData;
      actions.appendChild(audio);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "削除";
    deleteBtn.addEventListener("click", () => deleteHistoryItem(item.id));
    actions.appendChild(deleteBtn);

    li.append(meta, actions);
    els.historyList.appendChild(li);
  });
}

function loadData() {
  const fallback = {
    settings: {
      saveAudio: false,
    },
    history: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return {
      settings: {
        saveAudio: Boolean(parsed?.settings?.saveAudio),
      },
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    };
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function persistData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (error) {
    console.error(error);
    showMessage("保存に失敗しました（容量超過の可能性があります）。", "error");
  }
}

function setState(state) {
  currentState = state;
  els.appState.textContent = currentState;
}

function showMessage(text, type = "") {
  els.message.textContent = text;
  els.message.className = "message";
  if (type) {
    els.message.classList.add(type);
  }
}

function cleanupMediaResources() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
  mediaRecorder = null;
  mediaStream = null;
  chunks = [];
}

function formatDate(iso) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
