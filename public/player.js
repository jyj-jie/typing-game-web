(function () {
  const socket = io();
  const storageKey = "typing-player-profile";
  const state = {
    config: null,
    player: null,
    currentView: "login",
    stayInWaitView: false,
    race: {
      status: "waiting",
      duration: 300,
      remainingSeconds: 300,
      articleTitle: "",
      articleContent: ""
    },
    typedChars: [],
    stats: createEmptyStats(),
    reportTimer: null,
    heartbeatTimer: null,
    countdownTimer: null,
    blurLocked: false,
    articleShakeUntil: 0,
    layoutSource: "",
    articleLines: [],
    lineMeta: [],
    lineValues: [],
    studentNames: [],
    selectedPlayerName: "",
    currentLineIndex: 0,
    currentPage: 0,
    linesPerPage: 4,
    lineMaxLength: 42,
    isComposing: false,
    composingLineIndex: -1,
    lastRenderedPage: -1
  };

  const refs = {
    loginView: document.getElementById("loginView"),
    waitView: document.getElementById("waitView"),
    raceView: document.getElementById("raceView"),
    resultView: document.getElementById("resultView"),
    loginForm: document.getElementById("loginForm"),
    className: document.getElementById("className"),
    selectedName: document.getElementById("selectedName"),
    studentNameList: document.getElementById("studentNameList"),
    loginButton: document.getElementById("loginButton"),
    loginError: document.getElementById("loginError"),
    socketBadge: document.getElementById("socketBadge"),
    waitClass: document.getElementById("waitClass"),
    waitName: document.getElementById("waitName"),
    waitStatus: document.getElementById("waitStatus"),
    raceIdentity: document.getElementById("raceIdentity"),
    remainingTime: document.getElementById("remainingTime"),
    speedValue: document.getElementById("speedValue"),
    accuracyValue: document.getElementById("accuracyValue"),
    progressValue: document.getElementById("progressValue"),
    progressFill: document.getElementById("progressFill"),
    warningText: document.getElementById("warningText"),
    articleTitle: document.getElementById("articleTitle"),
    articleDisplay: document.getElementById("articleDisplay"),
    raceStatusText: document.getElementById("raceStatusText"),
    resultSummary: document.getElementById("resultSummary"),
    resultGrid: document.getElementById("resultGrid"),
    backToWait: document.getElementById("backToWait"),
    toastStack: document.getElementById("toastStack")
  };

  init();

  async function init() {
    bindEvents();
    await loadConfig();
    await restoreProfile();
    connectSocket();
    startHeartbeat();
  }

  function bindEvents() {
    refs.loginForm.addEventListener("submit", handleLoginSubmit);
    refs.className.addEventListener("change", handleClassChange);
    refs.backToWait.addEventListener("click", () => {
      state.stayInWaitView = true;
      refs.waitStatus.textContent = "等待下一场比赛开始";
      showView("wait");
    });
    refs.articleDisplay.addEventListener("click", focusCapture);
  }

  async function loadConfig() {
    const response = await fetch("/api/config");
    state.config = await response.json();
    refs.className.innerHTML = state.config.classes
      .map((classItem) => `<option value="${classItem}">${classItem}</option>`)
      .join("");
    await loadStudentNames(refs.className.value);
  }

  async function restoreProfile() {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      renderStudentNameButtons();
      return;
    }

    try {
      const profile = JSON.parse(raw);
      if (profile.className) {
        refs.className.value = profile.className;
      }
      state.selectedPlayerName = profile.playerName || "";
      await loadStudentNames(refs.className.value);
    } catch (error) {
      sessionStorage.removeItem(storageKey);
    }
  }

  function connectSocket() {
    socket.on("connect", () => {
      updateSocketBadge(true);
      tryAutoJoin();
    });

    socket.on("disconnect", () => {
      updateSocketBadge(false);
      showToast("连接已断开", "系统正在尝试重连服务器。", "error");
    });

    socket.on("raceStateSync", ({ race, leaderboard }) => {
      state.race = race || state.race;
      if (race?.status === "ended" && !state.stayInWaitView) {
        showResultByLeaderboard(leaderboard);
      }
    });

    socket.on("startRace", (payload) => {
      state.stayInWaitView = false;
      state.race = {
        status: "running",
        duration: payload.duration,
        remainingSeconds: payload.duration,
        articleTitle: payload.articleTitle,
        articleContent: payload.articleContent,
        startedAt: payload.startedAt
      };
      resetRaceInputState();
      showView("race");
      renderRace(true);
      focusCapture();
      showToast("比赛开始", "请立即开始输入，最终成绩以服务器记录为准。", "success");
    });

    socket.on("racePaused", (payload) => {
      state.race.status = "paused";
      state.race.remainingSeconds = payload.remainingSeconds;
      renderRace(true);
      showToast("比赛已暂停", "裁判已暂停比赛，请原地等待。");
    });

    socket.on("raceResumed", (payload) => {
      state.race.status = "running";
      state.race.remainingSeconds = payload.remainingSeconds;
      renderRace(true);
      focusCapture();
      showToast("比赛继续", "请继续完成文章输入。", "success");
    });

    socket.on("raceEnd", ({ leaderboard }) => {
      state.race.status = "ended";
      state.race.remainingSeconds = 0;
      if (!state.stayInWaitView) {
        showResultByLeaderboard(leaderboard);
      }
      showToast("比赛结束", "系统已锁定输入并生成最终成绩。", "success");
    });

    socket.on("warningIssued", ({ warningCount }) => {
      state.stats.warningCount = warningCount;
      renderRace();
    });

    socket.on("systemMessage", () => {});

    socket.on("playerStatus", ({ race, player }) => {
      if (race) {
        state.race = race;
      }
      if (player) {
        state.player = {
          className: player.className,
          playerName: player.playerName
        };
        state.stats.warningCount = player.warningCount;
        state.stats.shortcutWarnings = player.shortcutWarnings;
        if (state.race.status === "ended" && !state.stayInWaitView) {
          showView("result");
        }
      }
      syncViews();
    });
  }

  function tryAutoJoin() {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw || state.player) {
      return;
    }

    try {
      const profile = JSON.parse(raw);
      if (!profile.className || !profile.playerName) {
        return;
      }
      joinPlayer(profile.className, profile.playerName);
    } catch (error) {
      sessionStorage.removeItem(storageKey);
    }
  }

  function handleLoginSubmit(event) {
    event.preventDefault();
    refs.loginError.textContent = "";
    joinPlayer(refs.className.value, state.selectedPlayerName);
  }

  function joinPlayer(className, playerName) {
    if (!className || !playerName) {
      refs.loginError.textContent = "请选择班级并点击自己的姓名";
      return;
    }

    socket.emit("joinPlayer", { className, playerName }, (result) => {
      if (!result?.success) {
        refs.loginError.textContent = result?.message || "登录失败";
        return;
      }

      state.player = {
        className,
        playerName
      };
      state.selectedPlayerName = playerName;
      state.stayInWaitView = false;
      sessionStorage.setItem(storageKey, JSON.stringify(state.player));
      state.race = result.race || state.race;
      syncViews();

      if (state.race.status === "running" || state.race.status === "paused") {
        state.race.articleContent = result.race.articleContent;
        state.race.articleTitle = result.race.articleTitle;
        showView("race");
        renderRace();
      } else if (state.race.status === "ended" && !state.stayInWaitView) {
        showResultByLeaderboard(result.leaderboard);
      } else {
        showView("wait");
      }
    });
  }

  function syncViews() {
    if (!state.player) {
      showView("login");
      return;
    }

    refs.waitClass.textContent = state.player.className;
    refs.waitName.textContent = state.player.playerName;
    refs.raceIdentity.textContent = `${state.player.className} / ${state.player.playerName}`;

    if (state.race.status === "running" || state.race.status === "paused") {
      showView("race");
      renderRace(false);
      return;
    }

    if (state.race.status === "ended" && !state.stayInWaitView) {
      showView("result");
      return;
    }

    refs.waitStatus.textContent = state.stayInWaitView ? "等待下一场比赛开始" : "等待开始";
    showView("wait");
  }

  function showView(viewName) {
    if (state.currentView === viewName) {
      return;
    }

    refs.loginView.classList.toggle("hidden", viewName !== "login");
    refs.waitView.classList.toggle("hidden", viewName !== "wait");
    refs.raceView.classList.toggle("hidden", viewName !== "race");
    refs.resultView.classList.toggle("hidden", viewName !== "result");

    if (viewName === "race") {
      setTimeout(() => focusCapture(), 80);
    }

    state.currentView = viewName;
  }

  function updateDerivedStats() {
    let correctChars = 0;
    let typedLength = 0;

    for (let lineIndex = 0; lineIndex < state.articleLines.length; lineIndex += 1) {
      const expectedLine = state.articleLines[lineIndex] || "";
      const inputLine = state.lineValues[lineIndex] || "";
      typedLength += inputLine.length;

      for (let charIndex = 0; charIndex < inputLine.length; charIndex += 1) {
        if (inputLine[charIndex] === expectedLine[charIndex]) {
          correctChars += 1;
        }
      }
    }

    state.stats.correctChars = correctChars;
    state.stats.typedLength = typedLength;

    const elapsedSeconds = getElapsedSeconds();
    const minutes = Math.max(elapsedSeconds / 60, 1 / 60);
    const speed = correctChars / minutes;
    const accuracy =
      typedLength > 0
        ? (correctChars / typedLength) * 100
        : 100;
    const progress = state.race.articleContent
      ? (typedLength / state.race.articleContent.length) * 100
      : 0;

    state.stats.speed = round(speed);
    state.stats.accuracy = round(Math.max(accuracy, 0));
    state.stats.progress = round(Math.min(progress, 100));
    state.stats.errorKeystrokes = Math.max(typedLength - correctChars, 0);
  }

  function renderRace(forceArticleRender = false) {
    refs.articleTitle.textContent = state.race.articleTitle || "比赛文章";
    refs.remainingTime.textContent = formatSeconds(state.race.remainingSeconds || 0);
    refs.speedValue.textContent = formatNumber(state.stats.speed || 0);
    refs.accuracyValue.textContent = `${formatNumber(state.stats.accuracy || 100)}%`;
    refs.progressValue.textContent = `${formatNumber(state.stats.progress || 0)}%`;
    refs.progressFill.style.width = `${state.stats.progress || 0}%`;
    refs.warningText.textContent = `已输入 ${state.stats.typedLength || 0} 字 / 可按回车切换到下一行`;
    refs.raceStatusText.textContent =
      state.race.status === "paused" ? "比赛已暂停，等待裁判继续" : "比赛进行中";

    ensureArticleLayout();
    syncCurrentPage();

    if (state.isComposing) {
      return;
    }

    if (
      forceArticleRender ||
      refs.articleDisplay.childElementCount === 0 ||
      state.lastRenderedPage !== state.currentPage
    ) {
      renderArticlePage();
      return;
    }

    refreshVisiblePageState();
  }

  function ensureArticleLayout() {
    const article = state.race.articleContent || "";
    if (state.layoutSource === article) {
      return;
    }

    state.layoutSource = article;
    const lines = splitTextIntoLines(article, state.lineMaxLength);
    let startIndex = 0;
    state.articleLines = lines;
    state.lineMeta = lines.map((line) => {
      const meta = {
        text: line,
        startIndex,
        endIndex: startIndex + line.length
      };
      startIndex += line.length;
      return meta;
    });
    state.lineValues = lines.map(() => "");
    state.currentLineIndex = 0;
    state.currentPage = 0;
    state.lastRenderedPage = -1;
  }

  function renderArticlePage() {
    const shouldShake = Date.now() < state.articleShakeUntil;
    refs.articleDisplay.classList.toggle("article-shake", shouldShake);
    refs.articleDisplay.innerHTML = "";

    if (state.articleLines.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const totalPages = Math.max(1, Math.ceil(state.articleLines.length / state.linesPerPage));
    const startLine = state.currentPage * state.linesPerPage;
    const endLine = Math.min(startLine + state.linesPerPage, state.articleLines.length);
    const pageInfo = document.createElement("div");
    pageInfo.className = "page-info";
    pageInfo.textContent = `第 ${state.currentPage + 1} 页 / 共 ${totalPages} 页`;
    fragment.appendChild(pageInfo);

    for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
      const lineInfo = state.lineMeta[lineIndex];
      const lineWrapper = document.createElement("div");
      lineWrapper.className = "text-line";

      const textDiv = document.createElement("div");
      textDiv.className = "line-text";
      for (let offset = 0; offset < lineInfo.text.length; offset += 1) {
        const absoluteIndex = lineInfo.startIndex + offset;
        const span = document.createElement("span");
        span.className = "article-char";
        span.id = `char-${lineIndex}-${offset}`;
        span.dataset.absoluteIndex = String(absoluteIndex);
        span.textContent = lineInfo.text[offset];
        textDiv.appendChild(span);
      }

      const input = document.createElement("input");
      input.type = "text";
      input.className = "line-input";
      input.id = `line-input-${lineIndex}`;
      input.readOnly = true;
      input.placeholder = `请输入第${lineIndex + 1}行内容...`;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = state.lineValues[lineIndex] || "";
      input.addEventListener("focus", () => handleLineFocus(lineIndex));
      input.addEventListener("input", (event) => handleLineInput(event, lineIndex));
      input.addEventListener("keydown", (event) => handleLineKeydown(event, lineIndex));
      input.addEventListener("compositionstart", () => handleCompositionStart(lineIndex));
      input.addEventListener("compositionend", (event) => handleCompositionEnd(event, lineIndex));

      lineWrapper.appendChild(textDiv);
      lineWrapper.appendChild(input);
      fragment.appendChild(lineWrapper);
    }

    if (totalPages > 1) {
      const pagination = document.createElement("div");
      pagination.className = "pagination-controls";
      if (state.currentPage > 0) {
        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = "pagination-btn";
        prevBtn.textContent = "← 上一页";
        prevBtn.addEventListener("click", () => moveToLine((state.currentPage - 1) * state.linesPerPage));
        pagination.appendChild(prevBtn);
      }
      if (state.currentPage < totalPages - 1) {
        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "pagination-btn";
        nextBtn.textContent = "下一页 →";
        nextBtn.addEventListener("click", () => moveToLine((state.currentPage + 1) * state.linesPerPage));
        pagination.appendChild(nextBtn);
      }
      fragment.appendChild(pagination);
    }

    refs.articleDisplay.appendChild(fragment);
    state.lastRenderedPage = state.currentPage;
    refreshVisiblePageState();
    const currentNode = refs.articleDisplay.querySelector(".article-char.current, .article-char.error");
    if (currentNode) {
      currentNode.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function refreshVisiblePageState() {
    const startLine = state.currentPage * state.linesPerPage;
    const endLine = Math.min(startLine + state.linesPerPage, state.articleLines.length);

    for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
      const lineInfo = state.lineMeta[lineIndex];
      const input = document.getElementById(`line-input-${lineIndex}`);
      if (!input) {
        continue;
      }

      if (!(state.isComposing && state.composingLineIndex === lineIndex)) {
        input.value = state.lineValues[lineIndex] || "";
      }

      input.readOnly = state.race.status !== "running";
      input.classList.toggle("active", lineIndex === state.currentLineIndex);
      input.classList.toggle("completed", (state.lineValues[lineIndex] || "") === lineInfo.text && lineInfo.text.length > 0);

      const typedLine = state.lineValues[lineIndex] || "";

      for (let offset = 0; offset < lineInfo.text.length; offset += 1) {
        const charElement = document.getElementById(`char-${lineIndex}-${offset}`);
        if (!charElement) {
          continue;
        }
        charElement.classList.remove("correct", "error", "current");

        if (offset < typedLine.length && typedLine[offset] === lineInfo.text[offset]) {
          charElement.classList.add("correct");
        } else if (offset < typedLine.length) {
          charElement.classList.add("error");
        } else if (lineIndex === state.currentLineIndex && offset === typedLine.length) {
          charElement.classList.add("current");
        }
      }
    }
  }

  function syncCurrentPage() {
    const currentLine = state.currentLineIndex;
    const targetPage = Math.floor(currentLine / state.linesPerPage);
    if (targetPage !== state.currentPage) {
      state.currentPage = targetPage;
    }
  }

  function splitTextIntoLines(text, maxLength) {
    const normalized = String(text || "").replace(/\r/g, "");
    const paragraphs = normalized.split("\n").filter((item) => item.length > 0);
    const lines = [];

    paragraphs.forEach((paragraph) => {
      let currentLine = "";
      for (const char of paragraph) {
        currentLine += char;
        if (currentLine.length >= maxLength) {
          lines.push(currentLine);
          currentLine = "";
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
    });

    return lines;
  }

  function getFirstMismatchIndex() {
    for (let index = 0; index < state.typedChars.length; index += 1) {
      if (state.typedChars[index] !== state.race.articleContent[index]) {
        return index;
      }
    }
    return -1;
  }

  function startHeartbeat() {
    clearInterval(state.heartbeatTimer);
    clearInterval(state.reportTimer);
    clearInterval(state.countdownTimer);

    state.heartbeatTimer = setInterval(() => {
      if (socket.connected && state.player) {
        socket.emit("heartbeat");
      }
    }, 2000);

    state.reportTimer = setInterval(() => {
      if (!state.player || state.race.status !== "running") {
        return;
      }

      updateDerivedStats();
      socket.emit("updateProgress", {
        totalKeystrokes: state.stats.totalKeystrokes,
        errorKeystrokes: state.stats.errorKeystrokes,
        correctChars: state.stats.correctChars,
        backspaceCount: state.stats.backspaceCount,
        warningCount: state.stats.warningCount,
        typedLength: state.stats.typedLength,
        currentInput: state.typedChars.join("")
      });
      renderRace(false);
    }, 1000);

    state.countdownTimer = setInterval(() => {
      if (state.race.status !== "running") {
        return;
      }
      state.race.remainingSeconds = Math.max(0, state.race.remainingSeconds - 1);
      updateDerivedStats();
      renderRace(false);
    }, 1000);
  }

  function showResultByLeaderboard(leaderboard) {
    if (!leaderboard || !state.player) {
      return;
    }

    const playerResult = leaderboard.players.find(
      (item) => item.className === state.player.className && item.playerName === state.player.playerName
    );
    const classResult = leaderboard.classes.find((item) => item.className === state.player.className);

    if (!playerResult) {
      refs.resultSummary.textContent = "未找到当前选手成绩，请联系裁判查看后台记录。";
      showView("result");
      return;
    }

    refs.resultSummary.textContent = playerResult.disqualified
      ? `本场比赛成绩已取消，原因：${playerResult.disqualifyReason || "失焦违规"}。`
      : `你已完成比赛，个人排名第 ${playerResult.rank} 名，班级排名第 ${classResult?.rank || "-"} 名。`;

    refs.resultGrid.innerHTML = "";
    [
      ["速度", `${formatNumber(playerResult.speed)} 字/分钟`],
      ["准确率", `${formatNumber(playerResult.accuracy)}%`],
      ["得分", formatNumber(playerResult.score)],
      ["已输入字数", String(playerResult.typedLength)],
      ["正确字数", String(playerResult.correctChars)],
      ["班级总分", formatNumber(classResult?.totalScore || 0)],
      ["班级排名", `第 ${classResult?.rank || "-"} 名`]
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "mini-card";
      card.innerHTML = `<span class="muted">${label}</span><strong>${value}</strong>`;
      refs.resultGrid.appendChild(card);
    });

    showView("result");
  }

  function updateSocketBadge(connected) {
    refs.socketBadge.innerHTML = connected
      ? '<span class="status-dot"></span> 已连接'
      : '<span class="status-dot offline"></span> 已断开';
  }

  function focusCapture() {
    if (state.race.status !== "running") {
      return;
    }
    const currentInput = document.getElementById(`line-input-${state.currentLineIndex}`);
    if (currentInput) {
      currentInput.focus({ preventScroll: true });
      const valueLength = currentInput.value.length;
      currentInput.setSelectionRange(valueLength, valueLength);
    }
  }

  function getElapsedSeconds() {
    if (!state.race.duration) {
      return 0;
    }
    return Math.max(1, state.race.duration - (state.race.remainingSeconds || 0));
  }

  function showToast(title, message, type) {
    const item = document.createElement("div");
    item.className = `toast ${type || ""}`.trim();
    item.innerHTML = `<strong>${title}</strong><div>${message}</div>`;
    refs.toastStack.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }

  function formatSeconds(totalSeconds) {
    const safe = Math.max(0, Number(totalSeconds) || 0);
    const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
    const seconds = String(safe % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatNumber(value) {
    return Number(value || 0).toFixed(2);
  }

  function round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function createEmptyStats() {
    return {
      totalKeystrokes: 0,
      errorKeystrokes: 0,
      correctChars: 0,
      backspaceCount: 0,
      warningCount: 0,
      shortcutWarnings: 0,
      typedLength: 0,
      speed: 0,
      accuracy: 100,
      progress: 0
    };
  }

  function resetRaceInputState() {
    state.typedChars = [];
    state.stats = createEmptyStats();
    state.layoutSource = "";
    state.articleLines = [];
    state.lineMeta = [];
    state.lineValues = [];
    state.currentLineIndex = 0;
    state.currentPage = 0;
    state.lastRenderedPage = -1;
    state.isComposing = false;
    state.composingLineIndex = -1;
  }

  async function handleClassChange() {
    refs.loginError.textContent = "";
    state.selectedPlayerName = "";
    await loadStudentNames(refs.className.value);
  }

  async function loadStudentNames(className) {
    if (!className) {
      state.studentNames = [];
      renderStudentNameButtons();
      return;
    }

    const response = await fetch(`/api/student-roster?className=${encodeURIComponent(className)}`);
    const result = await response.json();
    state.studentNames = Array.isArray(result.students) ? result.students : [];
    renderStudentNameButtons();
  }

  function renderStudentNameButtons() {
    refs.studentNameList.innerHTML = "";
    refs.loginButton.disabled = !state.selectedPlayerName;

    if (state.studentNames.length === 0) {
      refs.selectedName.textContent = "该班级暂未导入学生名单";
      const empty = document.createElement("div");
      empty.className = "empty-text";
      empty.textContent = "请先由老师在管理端导入该班学生名单";
      refs.studentNameList.appendChild(empty);
      return;
    }

    const savedName =
      state.selectedPlayerName && state.studentNames.includes(state.selectedPlayerName)
        ? state.selectedPlayerName
        : "";
    state.selectedPlayerName = savedName;
    refs.selectedName.textContent = savedName ? `已选择：${savedName}` : "请选择自己的姓名";
    refs.loginButton.disabled = !savedName;

    state.studentNames.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `name-button ${name === savedName ? "active" : ""}`.trim();
      button.textContent = name;
      button.addEventListener("click", () => {
        state.selectedPlayerName = name;
        refs.selectedName.textContent = `已选择：${name}`;
        refs.loginButton.disabled = false;
        renderStudentNameButtons();
        joinPlayer(refs.className.value, name);
      });
      refs.studentNameList.appendChild(button);
    });
  }

  function handleLineFocus(lineIndex) {
    if (state.race.status !== "running") {
      return;
    }
    state.currentLineIndex = lineIndex;
    renderRace(false);
  }

  function handleLineKeydown(event, lineIndex) {
    if (state.race.status !== "running") {
      event.preventDefault();
      return;
    }

    if (event.isComposing || (state.isComposing && state.composingLineIndex === lineIndex)) {
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveToLine(Math.max(0, lineIndex - 1));
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveToLine(Math.min(state.articleLines.length - 1, lineIndex + 1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      moveToLine(Math.min(state.articleLines.length - 1, lineIndex + 1));
      return;
    }

    if (event.key === "Backspace") {
      state.stats.backspaceCount += 1;
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      state.stats.totalKeystrokes += 1;
    }
  }

  function handleCompositionStart(lineIndex) {
    state.isComposing = true;
    state.composingLineIndex = lineIndex;
    state.currentLineIndex = lineIndex;
  }

  function handleCompositionEnd(event, lineIndex) {
    state.isComposing = false;
    state.composingLineIndex = -1;
    handleLineInput(event, lineIndex, true);
  }

  function handleLineInput(event, lineIndex, forceRefresh = false) {
    if (state.race.status !== "running" && state.race.status !== "paused") {
      return;
    }

    if (state.isComposing && state.composingLineIndex === lineIndex && !forceRefresh) {
      state.currentLineIndex = lineIndex;
      return;
    }

    const lineText = state.articleLines[lineIndex] || "";
    const rawValue = String(event.target.value || "");
    const trimmedValue = rawValue.length > lineText.length ? rawValue.slice(0, lineText.length) : rawValue;
    if (event.target.value !== trimmedValue) {
      event.target.value = trimmedValue;
    }

    state.lineValues[lineIndex] = trimmedValue;
    state.currentLineIndex = lineIndex;
    normalizeLineValues();
    rebuildTypedCharsFromLines();
    updateDerivedStats();

    for (let charIndex = 0; charIndex < trimmedValue.length; charIndex += 1) {
      if (trimmedValue[charIndex] !== lineText[charIndex]) {
        state.articleShakeUntil = Date.now() + 220;
        break;
      }
    }

    if (!state.isComposing || forceRefresh) {
      renderRace(false);
      if ((state.lineValues[lineIndex] || "").length >= lineText.length && lineIndex < state.articleLines.length - 1) {
        moveToLine(lineIndex + 1);
      }
    }
  }

  function normalizeLineValues() {
    for (let index = 0; index < state.articleLines.length; index += 1) {
      const fullText = state.articleLines[index];
      state.lineValues[index] = String(state.lineValues[index] || "").slice(0, fullText.length);
    }
  }

  function rebuildTypedCharsFromLines() {
    state.typedChars = state.lineValues.join("").split("");
    state.stats.typedLength = state.typedChars.length;
  }

  function moveToLine(targetLineIndex) {
    const safeIndex = Math.max(0, Math.min(targetLineIndex, state.articleLines.length - 1));
    state.currentLineIndex = safeIndex;
    syncCurrentPage();
    renderRace(true);
    focusCapture();
  }
})();
