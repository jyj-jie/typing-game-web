import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import crypto from "crypto";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const storageDir = path.join(__dirname, "storage");
const resultFile = path.join(storageDir, "results.json");
const studentRosterFile = path.join(storageDir, "student-roster.json");
const articlesFile = path.join(storageDir, "articles.json");
const checkpointFile = path.join(storageDir, "race-checkpoint.json");
const vendorXlsxDir = path.join(__dirname, "node_modules", "xlsx", "dist");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DEFAULT_DURATION = 30 * 60;
const HEARTBEAT_INTERVAL = 2000;
const DISCONNECT_THRESHOLD = Number(process.env.DISCONNECT_THRESHOLD || 15000);
const SPEED_HISTORY_WINDOW_MS = 60000;
const RECENT_SPEED_WINDOW_MS = 30000;
const CHECKPOINT_INTERVAL = Number(process.env.CHECKPOINT_INTERVAL || 10000);
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || "1mb";
const STATE_BROADCAST_MIN_INTERVAL = 2000;
const HEARTBEAT_CHECK_INTERVAL = 3000;
const IDLE_BROADCAST_INTERVAL = 5000;

let classList = [];

const BUILT_IN_ARTICLES = [
  {
    id: "article-1",
    title: "我们的校园",
    content: "我们的校园很美。每天早晨，同学们背着书包来到学校。校门口的大树在风中轻轻摇摆。操场上有红色的跑道，体育课上大家跑步、跳绳、做游戏。教学楼有五层，教室很明亮，墙上贴满了画。上课认真听讲，下课在走廊聊天。图书馆有很多好书，食堂饭菜很香。放学了，我们排好队和老师说再见。校园就是我们的大家，每天都有新收获。"
  },
  {
    id: "article-2",
    title: "我爱大自然",
    content: "春天到了，小草钻出地面，花儿开了，五颜六色真好看。小鸟在枝头唱歌，蝴蝶在花丛中飞来飞去。夏天很热，大树长满绿叶，像一把把大伞。池塘里荷花开了一大片，粉色的花瓣好看极了。秋天来了，天气变凉，树叶变黄变红，一片片落下来。田野里稻谷金黄，果园里果实累累的。冬天北风呼呼吹，有时还会下雪，大地盖上了白被子。小朋友们堆雪人、打雪仗，开心极了。一年四季，大自然送给我们不同的礼物。我们要爱护环境，让地球一直美丽。"
  },
  {
    id: "article-3",
    title: "快乐的一天",
    content: "星期天早晨，阳光照进房间，我早早起床，因为爸爸妈妈要带我去公园玩。我穿上最喜欢的运动鞋，背上小背包就出发了。公园里人很多，我们先去了湖边。湖水很清，能看到小鱼游来游去。爸爸买了鱼食，我撒进水里，小鱼围过来抢着吃，样子可爱极了。看完鱼，我们去了游乐区坐了旋转木马。我选了一匹白色小马，木马随着音乐转起来真好玩。玩累了，妈妈铺好垫子，我们在草地上吃零食。我一边吃一边看天上的云朵，有的像小狗、有的像棉花糖。吃完东西我们在公园里散步看花。太阳慢慢地落下，爸爸说该回家了，虽然有点舍不得，但今天过得真是开心。"
  }
];

let articles = [];

const app = express();
const server = http.createServer(app);
server.maxConnections = 150;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
const io = new Server(server, {
  pingTimeout: 10000,
  pingInterval: 5000,
  connectTimeout: 10000,
  maxHttpBufferSize: 1e5,
  perMessageDeflate: false,
  transports: ["polling", "websocket"],
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : [/^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/],
    methods: ["GET", "POST", "DELETE"],
    credentials: true
  }
});

const players = new Map();
const adminTokens = new Map();
let studentRoster = new Map();
let finalSnapshot = null;
let finalizing = false;
let stateDirty = false;
let lastBroadcastTime = 0;

const raceState = {
  status: "waiting",
  duration: DEFAULT_DURATION,
  articleId: "",
  articleTitle: "",
  articleContent: "",
  startedAt: null,
  pausedAt: null,
  endedAt: null,
  totalPausedMs: 0,
  remainingMsAtPause: null,
  endReason: ""
};

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use("/vendor/xlsx", express.static(vendorXlsxDir));
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    players: players.size,
    onlinePlayers: Array.from(players.values()).filter((p) => p.online).length,
    raceStatus: raceState.status,
    articleTitle: raceState.articleTitle,
    remainingSeconds: getRemainingSeconds(),
    timestamp: Date.now()
  });
});

app.get("/", (req, res) => {
  res.redirect("/player.html");
});

app.get("/api/config", (req, res) => {
  res.json({
    classes: classList,
    defaultDuration: DEFAULT_DURATION,
    maxDuration: 1800,
    minDuration: 60,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    disconnectThreshold: DISCONNECT_THRESHOLD,
    adminPasswordHint: "默认密码已内置，可通过 ADMIN_PASSWORD 环境变量修改"
  });
});

app.get("/api/articles", (req, res) => {
  res.json({
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      content: article.content,
      charCount: article.content.length
    }))
  });
});

app.get("/api/student-roster", (req, res) => {
  const className = String(req.query.className || "").trim();
  const students = className ? getRosterNames(className) : [];
  res.json({
    className,
    students
  });
});

app.post("/api/student-roster/temp", (req, res) => {
  const className = String(req.body?.className || "").trim();
  const playerName = String(req.body?.playerName || "").trim();

  if (!className || !playerName) {
    return res.status(400).json({ success: false, message: "班级和姓名不能为空" });
  }

  if (!classList.includes(className)) {
    return res.status(400).json({ success: false, message: "请选择有效班级" });
  }

  const classStudents = getRosterNames(className);
  if (classStudents.includes(playerName)) {
    return res.json({ success: true, exists: true, message: "该姓名已在名单中" });
  }

  if (!studentRoster.has(className)) {
    studentRoster.set(className, []);
  }
  const names = studentRoster.get(className);
  if (!names.includes(playerName)) {
    names.push(playerName);
    names.sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  return res.json({ success: true, message: "临时添加成功" });
});

app.get("/api/student-roster/stats", (_req, res) => {
  const classes = Array.from(studentRoster.entries())
    .map(([className, names]) => ({ className, studentCount: names.length }))
    .sort((a, b) => a.className.localeCompare(b.className, "zh-CN"));

  res.json({
    classes,
    totalClasses: classes.length,
    totalStudents: classes.reduce((sum, c) => sum + c.studentCount, 0)
  });
});

app.post("/api/student-roster", async (req, res) => {
  const token = String(req.body?.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).json({
      success: false,
      message: "管理员身份无效，请重新登录"
    });
  }

  const students = normalizeStudentRows(req.body?.students || []);
  if (students.length === 0) {
    return res.status(400).json({
      success: false,
      message: "未识别到有效的班级和学生姓名数据"
    });
  }

  const seenKeys = new Set();
  for (const s of students) {
    const key = `${s.className}__${s.playerName}`;
    if (seenKeys.has(key)) {
      return res.status(400).json({
        success: false,
        message: `学生"${s.playerName}"在班级"${s.className}"中重复`
      });
    }
    seenKeys.add(key);
  }

  await persistStudentRoster();
  setStudentRoster(students);
  return res.json({
    success: true,
    classCount: studentRoster.size,
    studentCount: Array.from(studentRoster.values()).reduce((total, names) => total + names.length, 0),
    message: "学生名单导入成功"
  });
});

app.delete("/api/student-roster", async (req, res) => {
  const token = String(req.query.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).json({ success: false, message: "管理员身份无效" });
  }

  studentRoster = new Map();
  rebuildClassList();
  await persistStudentRoster();

  try {
    await fs.unlink(resultFile);
  } catch (_e) {}
  try {
    await fs.unlink(checkpointFile);
  } catch (_e) {}

  finalSnapshot = null;
  players.clear();
  raceState.status = "waiting";
  setDefaultArticle();
  raceState.startedAt = null;
  raceState.pausedAt = null;
  raceState.endedAt = null;
  raceState.totalPausedMs = 0;
  raceState.remainingMsAtPause = null;
  raceState.endReason = "";

  emitAllStates();

  return res.json({ success: true, message: "学生名单及历史成绩已清除" });
});

app.post("/api/articles", async (req, res) => {
  const token = String(req.body?.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).json({
      success: false,
      message: "管理员身份无效，请重新登录"
    });
  }

  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").replace(/\r/g, "").trim();

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "请输入文章标题"
    });
  }

  if (content.length < 100 || content.length > 10000) {
    return res.status(400).json({
      success: false,
      message: "文章内容需在100~10000字之间"
    });
  }

  const article = {
    id: `article-${Date.now()}`,
    title,
    content
  };

  await persistArticles();
  articles = [...articles, article];
  return res.json({
    success: true,
    article: { ...article, charCount: article.content.length },
    message: "比赛文章导入成功"
  });
});

app.delete("/api/articles/:id", async (req, res) => {
  const token = String(req.query.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).json({ success: false, message: "管理员身份无效" });
  }

  const articleId = req.params.id;
  const target = articles.find((a) => a.id === articleId);
  if (!target) {
    return res.status(404).json({ success: false, message: "文章不存在" });
  }

  const builtInIds = BUILT_IN_ARTICLES.map((a) => a.id);
  if (builtInIds.includes(target.id)) {
    return res.status(400).json({ success: false, message: "内置文章不可删除" });
  }

  articles = articles.filter((a) => a.id !== articleId);
  await persistArticles();
  return res.json({ success: true, message: "已删除文章" });
});

app.get("/api/state", (req, res) => {
  const token = String(req.query.token || "");
  if (!isAdminTokenValid(token)) {
    res.status(401).json({ success: false, message: "未授权" });
    return;
  }
  const playerRows = buildPlayerAdminRows().map((p) => {
    const { ip, ...rest } = p;
    return rest;
  });
  res.json({
    race: buildPublicRaceState(),
    leaderboard: getCurrentSnapshot(),
    players: playerRows
  });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "密码错误"
    });
  }

  const token = crypto.randomUUID();
  adminTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
  return res.json({
    success: true,
    token,
    message: "登录成功"
  });
});

app.get("/api/export", (req, res) => {
  const token = String(req.query.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).send("未授权导出");
  }

  const snapshot = getCurrentSnapshot();
  const csv = buildCsv(snapshot);
  const fileName = `typing-race-result-${Date.now()}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(`\uFEFF${csv}`);
});

io.on("connection", (socket) => {
  const safe = (handler) =>
    (...args) => {
      let responded = false;
      const rawCb = args[args.length - 1];
      if (typeof rawCb === "function") {
        const original = rawCb;
        args[args.length - 1] = (...cbArgs) => {
          if (!responded) {
            responded = true;
            original(...cbArgs);
          }
        };
      }
      try {
        return handler(...args);
      } catch (err) {
        console.error(`Socket 事件处理异常 [${socket.id}]:`, err.message);
        const cb = args[args.length - 1];
        if (!responded && typeof cb === "function") {
          responded = true;
          try { cb({ success: false, message: "服务器处理异常，请稍后重试" }); } catch (_e) {}
        }
      }
    };

  socket.emit("raceStateSync", {
    race: buildPublicRaceState(),
    leaderboard: getCurrentSnapshot()
  });

  {
    const names = [];
    for (const player of players.values()) {
      if (player.online) {
        names.push({ className: player.className, playerName: player.playerName });
      }
    }
    socket.emit("activePlayersUpdate", names);
  }

  socket.on("joinPlayer", (payload, callback = () => {}) => {
    try {
      const className = String(payload?.className || "").trim();
      const playerName = String(payload?.playerName || "").trim();

      if (!classList.includes(className)) {
        callback({ success: false, message: "请选择有效班级" });
        return;
      }

      if (!playerName) {
        callback({ success: false, message: "请输入姓名" });
        return;
      }

      const classStudents = getRosterNames(className);
      if (classStudents.length > 0 && !classStudents.includes(playerName)) {
        callback({ success: false, message: "该姓名不在当前班级名单中，请重新选择" });
        return;
      }

      const playerId = getPlayerId(className, playerName);
      const existingPlayer = players.get(playerId);
      const raceLocked = raceState.status === "running" || raceState.status === "paused";
      const ip = getClientIp(socket);
      let player = existingPlayer;

      if (!player && raceLocked) {
        player = createPlayerRecord({
          className,
          playerName,
          ip,
          socketId: socket.id
        });
        players.set(playerId, player);
        socket.data.role = "player";
        socket.data.playerId = playerId;
        socket.join("players");

        const remaining = getRemainingSeconds();
        callback({
          success: true,
          player: buildPlayerSelfRow(player),
          race: buildPublicRaceState(),
          leaderboard: getCurrentSnapshot()
        });

        socket.emit("startRace", {
          articleId: raceState.articleId,
          articleTitle: raceState.articleTitle,
          articleContent: raceState.articleContent,
          duration: raceState.duration,
          startedAt: raceState.startedAt,
          remainingSeconds: remaining
        });

        emitAllStates();
        return;
      }

      if (existingPlayer && existingPlayer.submitted && raceLocked) {
        callback({ success: false, message: "你已提交本次比赛，不能重复进入" });
        return;
      }

      if (existingPlayer && existingPlayer.online && existingPlayer.socketId !== socket.id) {
        const forceReconnect = Boolean(payload?.force);
        if (!forceReconnect) {
          callback({ success: false, message: "该选手已在其他设备登录，是否强制换绑？" });
          return;
        }
        const oldSocket = io.sockets.sockets.get(existingPlayer.socketId);
        if (oldSocket) {
          oldSocket.emit("systemMessage", { message: "您的连接已被新设备替换" });
          oldSocket.disconnect(true);
        }
      }

      if (!player) {
        player = createPlayerRecord({
          className,
          playerName,
          ip,
          socketId: socket.id
        });
        players.set(playerId, player);
      } else {
        player.socketId = socket.id;
        player.ip = ip;
        player.online = true;
        player.lastHeartbeat = Date.now();
      }

      socket.data.role = "player";
      socket.data.playerId = playerId;
      socket.join("players");

      callback({
        success: true,
        player: buildPlayerSelfRow(player),
        race: buildPublicRaceState(),
        leaderboard: getCurrentSnapshot()
      });

      emitAllStates();
    } catch (error) {
      callback({ success: false, message: "加入比赛失败" });
    }
  });

  socket.on("joinAdmin", (payload, callback = () => {}) => {
    const token = String(payload?.token || "");
    if (!isAdminTokenValid(token)) {
      callback({ success: false, message: "管理员身份无效，请重新登录" });
      return;
    }

    socket.data.role = "admin";
    socket.data.adminToken = token;
    socket.join("admins");

    callback({
      success: true,
      race: buildPublicRaceState(),
      leaderboard: getCurrentSnapshot(),
      players: buildPlayerAdminRows()
    });
  });

  socket.on("joinScreen", (_payload, callback = () => {}) => {
    socket.data.role = "screen";
    socket.join("screens");
    callback({
      success: true,
      race: buildPublicRaceState(),
      leaderboard: getCurrentSnapshot()
    });
  });

  socket.on("heartbeat", () => {
    const player = getSocketPlayer(socket);
    if (!player) {
      return;
    }

    const wasOffline = !player.online;
    player.online = true;
    player.lastHeartbeat = Date.now();
    if (wasOffline) {
      markStateDirty();
    }
  });

  socket.on("updateProgress", safe((payload = {}) => {
    const player = getSocketPlayer(socket);
    if (!player || raceState.status !== "running") {
      return;
    }

    const totalKeystrokes = clampNumber(payload?.totalKeystrokes, 0, 999999);
    const errorKeystrokes = clampNumber(payload?.errorKeystrokes, 0, 999999);
    const correctChars = clampNumber(payload?.correctChars, 0, 999999);
    const backspaceCount = clampNumber(payload?.backspaceCount, 0, 999);
    const warningCount = clampNumber(payload?.warningCount, 0, 999);
    const typedLength = clampNumber(payload?.typedLength, 0, 999999);
    const articleLength = raceState.articleContent.length || 1;

    player.online = true;
    player.lastHeartbeat = Date.now();
    player.stats.totalKeystrokes = totalKeystrokes;
    player.stats.errorKeystrokes = errorKeystrokes;
    player.stats.correctChars = correctChars;
    player.stats.backspaceCount = backspaceCount;
    player.stats.warningCount = warningCount;
    player.stats.typedLength = typedLength;
    player.stats.currentInput = String(payload.currentInput || "").slice(0, articleLength * 2);
    player.stats.lineValues = Array.isArray(payload.lineValues) ? payload.lineValues.slice(0, 200) : [];
    player.stats.updatedAt = Date.now();

    player.stats.speedHistory = player.stats.speedHistory || [];
    player.stats.speedHistory.push({ correctChars, timestamp: Date.now() });
    const historyCutoff = Date.now() - SPEED_HISTORY_WINDOW_MS;
    player.stats.speedHistory = player.stats.speedHistory.filter((h) => h.timestamp >= historyCutoff);

    markStateDirty();
  }));

  socket.on("playerSubmit", safe((payload, callback = () => {}) => {
    const player = getSocketPlayer(socket);
    if (!player) {
      callback({ success: false, message: "未找到选手信息" });
      return;
    }

    if (player.submitted) {
      callback({ success: false, message: "你已经提交过比赛，请等待裁判公布结果" });
      return;
    }

    if (raceState.status !== "running" && raceState.status !== "paused") {
      callback({ success: false, message: "当前不在比赛状态" });
      return;
    }

    const totalKeystrokes = clampNumber(payload?.totalKeystrokes, 0, 999999);
    const errorKeystrokes = clampNumber(payload?.errorKeystrokes, 0, 999999);
    const correctChars = clampNumber(payload?.correctChars, 0, 999999);
    const typedLength = clampNumber(payload?.typedLength, 0, 999999);
    const articleLength = raceState.articleContent.length || 1;

    player.stats.totalKeystrokes = totalKeystrokes;
    player.stats.errorKeystrokes = errorKeystrokes;
    player.stats.correctChars = correctChars;
    player.stats.typedLength = typedLength;
    player.stats.currentInput = String(payload.currentInput || "").slice(0, articleLength * 2);
    player.stats.lineValues = Array.isArray(payload.lineValues) ? payload.lineValues.slice(0, 200) : [];
    player.stats.updatedAt = Date.now();
    player.submitted = true;

    const finalMetrics = calculateMetrics(player, getElapsedMs());
    player.finalMetrics = finalMetrics;
    const currentSnapshot = buildLeaderboardSnapshot();
    const playerResult = currentSnapshot.players.find(
      (p) => p.className === player.className && p.playerName === player.playerName
    );
    const classResult = currentSnapshot.classes.find((c) => c.className === player.className);

    const playerSelf = buildPlayerSelfRow(player, finalMetrics, classResult);

    socket.emit("playerSubmitted", {
      success: true,
      player: playerSelf,
      playerResult,
      classResult,
      rank: playerResult?.rank || "-"
    });

    io.to("admins").emit("adminState", buildAdminState());
    emitAllStates();

    callback({ success: true, message: "提交成功" });
  }));


  socket.on("adminStartRace", safe((payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权开始比赛" });
      return;
    }

    if (raceState.status === "running" || raceState.status === "paused") {
      callback({ success: false, message: "比赛正在进行中" });
      return;
    }

    if (articles.length === 0) {
      callback({ success: false, message: "暂无可用的比赛文章，请先导入文章" });
      return;
    }

    const article = articles.find((item) => item.id === payload?.articleId) || articles[0];
    if (!article) {
      callback({ success: false, message: "所选文章不存在" });
      return;
    }

    const duration = clampNumber(payload?.duration, 60, 1800);
    if (players.size === 0) {
      callback({ success: false, message: "请至少先让 1 名学生登录后再开始比赛" });
      return;
    }

    finalSnapshot = null;
    finalizing = false;
    raceState.status = "running";
    raceState.duration = duration;
    raceState.articleId = article.id;
    raceState.articleTitle = article.title;
    raceState.articleContent = article.content;
    raceState.startedAt = Date.now();
    raceState.pausedAt = null;
    raceState.endedAt = null;
    raceState.totalPausedMs = 0;
    raceState.remainingMsAtPause = null;
    raceState.endReason = "";

    for (const player of players.values()) {
      player.disqualified = false;
      player.disqualifyReason = "";
      player.submitted = false;
      player.finalMetrics = null;
      player.stats = createEmptyStats();
      player.lastHeartbeat = Date.now();
    }

    io.emit("startRace", {
      articleId: article.id,
      articleTitle: article.title,
      articleContent: article.content,
      duration,
      startedAt: raceState.startedAt
    });

    emitAllStates();
    callback({ success: true, message: "比赛已开始" });
  }));

  socket.on("adminPauseRace", safe((_payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权暂停比赛" });
      return;
    }

    if (raceState.status !== "running") {
      callback({ success: false, message: "当前不在比赛中" });
      return;
    }

    const elapsedMs = getElapsedMs();
    raceState.status = "paused";
    raceState.pausedAt = Date.now();
    raceState.remainingMsAtPause = Math.max(0, raceState.duration * 1000 - elapsedMs);

    io.emit("racePaused", {
      pausedAt: raceState.pausedAt,
      remainingSeconds: Math.ceil(raceState.remainingMsAtPause / 1000)
    });

    emitAllStates();
    callback({ success: true, message: "比赛已暂停" });
  }));

  socket.on("adminResumeRace", safe((_payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权继续比赛" });
      return;
    }

    if (raceState.status !== "paused" || !raceState.pausedAt) {
      callback({ success: false, message: "当前未处于暂停状态" });
      return;
    }

    raceState.totalPausedMs += Date.now() - raceState.pausedAt;
    raceState.status = "running";
    raceState.pausedAt = null;
    raceState.remainingMsAtPause = null;

    io.emit("raceResumed", {
      resumedAt: Date.now(),
      remainingSeconds: getRemainingSeconds()
    });

    emitAllStates();
    callback({ success: true, message: "比赛已继续" });
  }));

  socket.on("adminEndRace", safe((_payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权结束比赛" });
      return;
    }

    finalizeRace("manual")
      .then(() => callback({ success: true, message: "比赛已结束" }))
      .catch((err) => {
        console.error("结束比赛失败：", err.message);
        callback({ success: false, message: "结束比赛失败" });
      });
  }));

  socket.on("disconnect", () => {
    const player = getSocketPlayer(socket);
    if (player) {
      player.online = false;
      player.socketId = "";
      player.stats.updatedAt = Date.now();
    }

    emitAllStates();
  });
});

const ticker = setInterval(async () => {
  cleanExpiredAdminTokens();

  if (raceState.status === "running" && tickerCheckpoint()) {
    await saveCheckpoint();
  }

  if (raceState.status === "running" && getRemainingSeconds() <= 0) {
    await finalizeRace("timeout");
    return;
  }

  const now = Date.now();
  if (stateDirty && now - lastBroadcastTime >= STATE_BROADCAST_MIN_INTERVAL) {
    emitAllStates();
  } else if (!stateDirty && now - lastBroadcastTime >= IDLE_BROADCAST_INTERVAL) {
    emitAllStates();
  }
}, 1000);

ticker.unref();

const heartbeatTimer = setInterval(() => {
  updateHeartbeatStatus();
}, HEARTBEAT_CHECK_INTERVAL);
heartbeatTimer.unref();

let lastCheckpointTime = 0;

function tickerCheckpoint() {
  const now = Date.now();
  if (now - lastCheckpointTime >= CHECKPOINT_INTERVAL) {
    lastCheckpointTime = now;
    return true;
  }
  return false;
}

async function saveCheckpoint() {
  try {
    const snapshot = buildLeaderboardSnapshot();
    const playerData = [];
    for (const [id, p] of players) {
      playerData.push({
        id: p.id,
        className: p.className,
        playerName: p.playerName,
        ip: p.ip,
        stats: p.stats,
        submitted: !!p.submitted,
        finalMetrics: p.finalMetrics || null
      });
    }
    const data = {
      savedAt: new Date().toISOString(),
      race: buildPublicRaceState(),
      totalPausedMs: raceState.totalPausedMs,
      leaderboard: snapshot,
      players: playerData
    };
    const tmp = checkpointFile + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, checkpointFile);
  } catch (err) {
    console.error("检查点保存失败：", err.message);
  }
}

async function loadCheckpoint() {
  try {
    const raw = await fs.readFile(checkpointFile, "utf8");
    const data = JSON.parse(raw);
    if (!data || !data.race) {
      return;
    }

    const race = data.race;
    if (race.status !== "waiting" && race.status !== "ended") {
      raceState.status = race.status;
      raceState.duration = race.duration;
      raceState.articleId = race.articleId;
      raceState.articleTitle = race.articleTitle;
      raceState.articleContent = race.articleContent;
      raceState.startedAt = race.startedAt;
      raceState.pausedAt = race.pausedAt;
      raceState.totalPausedMs = data.totalPausedMs || 0;
      raceState.remainingMsAtPause = null;
      raceState.endedAt = null;
      raceState.endReason = "";
    }

    if (Array.isArray(data.players)) {
      for (const p of data.players) {
        players.set(p.id, {
          id: p.id,
          className: p.className,
          playerName: p.playerName,
          ip: p.ip || "",
          socketId: "",
          online: false,
          connectedAt: Date.now(),
          lastHeartbeat: Date.now(),
          disqualified: false,
          disqualifyReason: "",
          submitted: !!p.submitted,
          stats: p.stats || {
            totalKeystrokes: 0,
            errorKeystrokes: 0,
            correctChars: 0,
            backspaceCount: 0,
            warningCount: 0,
            shortcutWarnings: 0,
            typedLength: 0,
            currentInput: "",
            lineValues: [],
            speedHistory: [],
            smoothedRecentSpeed: null,
            updatedAt: Date.now()
          },
          finalMetrics: p.finalMetrics || null
        });
      }
    }

    console.log(`检查点已恢复：${players.size} 名选手，比赛状态 ${raceState.status}`);
  } catch (_err) {
  }
}

function markStateDirty() {
  stateDirty = true;
}

server.listen(PORT, async () => {
  await ensureStorage();
  await loadArticles();
  await loadStudentRoster();
  await loadCheckpoint();
  rebuildClassList();
  setDefaultArticle();
  console.log(`打字比赛系统已启动：http://localhost:${PORT}`);
  console.log(`局域网访问地址：http://本机IP:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请关闭占用进程或设置环境变量 PORT 更换端口后重试。`);
  } else {
    console.error("服务器启动失败：", err.message);
  }
  process.exit(1);
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在安全关闭服务...`);
  if (raceState.status === "running" || raceState.status === "paused") {
    await finalizeRace("server_shutdown");
  }
  io.close();
  server.close(() => {
    console.log("服务已安全关闭");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("服务关闭超时，强制退出");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("未捕获异常：", err.message);
  gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  console.error("未处理的 Promise 拒绝：", reason);
});

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "接口不存在" });
});

app.use((err, _req, res, _next) => {
  console.error("服务端错误：", err.message);
  res.status(500).json({ success: false, message: "服务器内部错误" });
});

async function finalizeRace(reason) {
  if (finalizing) {
    return;
  }
  if (raceState.status === "ended" || raceState.status === "waiting") {
    return;
  }

  finalizing = true;
  try {
    if (raceState.status === "paused" && raceState.pausedAt) {
      raceState.endedAt = raceState.pausedAt;
    } else {
      raceState.endedAt = Date.now();
    }

    raceState.status = "ended";
    raceState.endReason = reason;

    const elapsed = getElapsedMs();
    for (const player of players.values()) {
      if (!player.submitted) {
        player.submitted = true;
        player.finalMetrics = calculateMetrics(player, elapsed);
      }
    }

    finalSnapshot = buildLeaderboardSnapshot();
    await persistResults(finalSnapshot);

    io.emit("raceEnd", {
      reason,
      race: buildPublicRaceState(),
      leaderboard: finalSnapshot
    });

    emitAllStates();
  } finally {
    finalizing = false;
  }
}

function emitAllStates() {
  stateDirty = false;
  lastBroadcastTime = Date.now();
  const publicRace = buildPublicRaceState();
  const snapshot = getCurrentSnapshot();
  const playerRows = buildPlayerAdminRows(snapshot);

  io.emit("leaderboardUpdate", snapshot);
  io.to("admins").emit("adminState", {
    race: publicRace,
    leaderboard: snapshot,
    players: playerRows
  });
  io.to("screens").emit("screenState", {
    race: publicRace,
    leaderboard: snapshot
  });

  const activeNames = [];
  for (const player of players.values()) {
    if (player.online) {
      activeNames.push({ className: player.className, playerName: player.playerName });
    }
  }
  io.emit("activePlayersUpdate", activeNames);

  const playerSnapMap = new Map();
  for (const item of snapshot.players) {
    playerSnapMap.set(item.id, item);
  }
  for (const player of players.values()) {
    if (!player.socketId) {
      continue;
    }

    const selfResult = playerSnapMap.get(player.id) || null;
    const classResult = snapshot.classes.find((item) => item.className === player.className) || null;

    io.to(player.socketId).emit("playerStatus", {
      race: publicRace,
      player: buildPlayerSelfRow(player, selfResult, classResult)
    });
  }
}

function getCurrentSnapshot() {
  if (raceState.status === "ended" && finalSnapshot) {
    return finalSnapshot;
  }
  return buildLeaderboardSnapshot();
}

function buildLeaderboardSnapshot() {
  const elapsedMs = getElapsedMs();
  const playerRows = Array.from(players.values()).map((player) => {
    const metrics = calculateMetrics(player, elapsedMs);
    return {
      id: player.id,
      className: player.className,
      playerName: player.playerName,
      ip: player.ip,
      online: player.online,
      speed: metrics.speed,
      recentSpeed: metrics.recentSpeed,
      accuracy: metrics.accuracy,
      score: metrics.score,
      totalKeystrokes: player.stats.totalKeystrokes,
      errorKeystrokes: player.stats.errorKeystrokes,
      correctChars: player.stats.correctChars,
      backspaceCount: player.stats.backspaceCount,
      warningCount: player.stats.warningCount,
      shortcutWarnings: player.stats.shortcutWarnings,
      typedLength: player.stats.typedLength,
      disqualified: metrics.disqualified,
      disqualifyReason: metrics.disqualifyReason,
      submitted: !!player.submitted
    };
  });

  playerRows.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.correctChars !== a.correctChars) {
      return b.correctChars - a.correctChars;
    }
    return a.playerName.localeCompare(b.playerName, "zh-CN");
  });

  playerRows.forEach((item, index) => {
    item.rank = index + 1;
  });

  const classMap = new Map();
  for (const row of playerRows) {
    if (!classMap.has(row.className)) {
      classMap.set(row.className, {
        className: row.className,
        totalScore: 0,
        playerCount: 0,
        validPlayerCount: 0
      });
    }

    const target = classMap.get(row.className);
    target.playerCount += 1;
    target.totalScore += row.score;
    target.validPlayerCount += 1;
  }

  const classes = Array.from(classMap.values())
    .map((item) => ({
      ...item,
      totalScore: roundNumber(item.totalScore)
    }))
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      return a.className.localeCompare(b.className, "zh-CN");
    });

  classes.forEach((item, index) => {
    item.rank = index + 1;
  });

  return {
    status: raceState.status,
    articleId: raceState.articleId,
    articleTitle: raceState.articleTitle,
    duration: raceState.duration,
    remainingSeconds: getRemainingSeconds(),
    updatedAt: Date.now(),
    classes,
    players: playerRows
  };
}

function buildPlayerAdminRows(existingSnapshot) {
  const snapshot = existingSnapshot || getCurrentSnapshot();
  return Array.from(players.values())
    .map((player) => {
      const metrics = snapshot.players.find((item) => item.id === player.id);
      return {
        id: player.id,
        className: player.className,
        playerName: player.playerName,
        ip: player.ip,
        online: player.online,
        lastHeartbeat: player.lastHeartbeat,
        progressPercent: getArticleProgressPercent(player.stats.correctChars),
        correctChars: player.stats.correctChars,
        totalKeystrokes: player.stats.totalKeystrokes,
        errorKeystrokes: player.stats.errorKeystrokes,
        backspaceCount: player.stats.backspaceCount,
        warningCount: player.stats.warningCount,
        shortcutWarnings: player.stats.shortcutWarnings,
        speed: metrics?.speed || 0,
        recentSpeed: metrics?.recentSpeed || 0,
        accuracy: metrics?.accuracy || 0,
        submitted: !!player.submitted,
        score: metrics?.score || 0,
        rank: metrics?.rank || "-"
      };
    })
    .sort((a, b) => {
      const rankA = Number(a.rank);
      const rankB = Number(b.rank);
      const safeRankA = Number.isFinite(rankA) ? rankA : 999999;
      const safeRankB = Number.isFinite(rankB) ? rankB : 999999;
      if (safeRankA !== safeRankB) {
        return safeRankA - safeRankB;
      }
      return a.playerName.localeCompare(b.playerName, "zh-CN");
    });
}

function buildPlayerSelfRow(player, metrics, classResult) {
  const playerMetrics = metrics || calculateMetrics(player, getElapsedMs());
  return {
    id: player.id,
    className: player.className,
    playerName: player.playerName,
    online: player.online,
    submitted: !!player.submitted,
    warningCount: player.stats.warningCount,
    shortcutWarnings: player.stats.shortcutWarnings,
    totalKeystrokes: player.stats.totalKeystrokes,
    errorKeystrokes: player.stats.errorKeystrokes,
    correctChars: player.stats.correctChars,
    backspaceCount: player.stats.backspaceCount,
    typedLength: player.stats.typedLength,
    lineValues: player.stats.lineValues || [],
    speed: playerMetrics.speed,
    accuracy: playerMetrics.accuracy,
    score: playerMetrics.score,
    disqualified: playerMetrics.disqualified,
    disqualifyReason: playerMetrics.disqualifyReason,
    rank: metrics?.rank || "-",
    classRank: classResult?.rank || "-",
    classTotalScore: classResult?.totalScore || 0
  };
}

function buildPublicRaceState() {
  return {
    status: raceState.status,
    duration: raceState.duration,
    articleId: raceState.articleId,
    articleTitle: raceState.articleTitle,
    articleContent: raceState.articleContent,
    startedAt: raceState.startedAt,
    pausedAt: raceState.pausedAt,
    endedAt: raceState.endedAt,
    remainingSeconds: getRemainingSeconds(),
    endReason: raceState.endReason
  };
}

function calculateMetrics(player, elapsedMs) {
  if (player.submitted && player.finalMetrics) {
    return player.finalMetrics;
  }

  const safeElapsedMs = Math.max(elapsedMs, 1000);
  const minutes = safeElapsedMs / 60000;
  const speed = player.stats.correctChars > 0 ? player.stats.correctChars / minutes : 0;
  const accuracyDecimal =
    player.stats.typedLength > 0
      ? player.stats.correctChars / player.stats.typedLength
      : 0;

  const articleLength = raceState.articleContent.length || 1;
  const completionRatio = Math.min(player.stats.correctChars / articleLength, 1);
  const completionScore = completionRatio * 80;
  const speedScore = Math.min(speed / 12, 1) * 40;
  const accuracyScore = accuracyDecimal * 30;
  const score = completionScore + speedScore + accuracyScore;

  const history = player.stats.speedHistory || [];
  const recentCutoff = Date.now() - RECENT_SPEED_WINDOW_MS;
  const recentEntries = history.filter((h) => h.timestamp >= recentCutoff);
  let rawRecentSpeed = speed;
  if (recentEntries.length >= 2) {
    const oldest = recentEntries[0];
    const newest = recentEntries[recentEntries.length - 1];
    const deltaChars = newest.correctChars - oldest.correctChars;
    const deltaMs = newest.timestamp - oldest.timestamp;
    if (deltaMs >= 1000 && deltaChars >= 0) {
      rawRecentSpeed = (deltaChars / (deltaMs / 60000));
    }
  }
  rawRecentSpeed = Math.max(rawRecentSpeed, 0);

  const prevSmoothed = player.stats.smoothedRecentSpeed;
  const alpha = 0.2;
  const smoothedRecentSpeed =
    prevSmoothed != null && prevSmoothed >= 0
      ? alpha * rawRecentSpeed + (1 - alpha) * prevSmoothed
      : rawRecentSpeed;
  player.stats.smoothedRecentSpeed = smoothedRecentSpeed;

  const disqualified = false;
  const disqualifyReason = "";

  return {
    speed: roundNumber(speed),
    recentSpeed: roundNumber(smoothedRecentSpeed),
    accuracy: roundNumber(accuracyDecimal * 100),
    score: roundNumber(Math.max(score, 0)),
    disqualified,
    disqualifyReason
  };
}

function createPlayerRecord({ className, playerName, ip, socketId }) {
  return {
    id: getPlayerId(className, playerName),
    className,
    playerName,
    ip,
    socketId,
    online: true,
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
    disqualified: false,
    disqualifyReason: "",
    submitted: false,
    stats: createEmptyStats()
  };
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
    currentInput: "",
    lineValues: [],
    speedHistory: [],
    smoothedRecentSpeed: null,
    updatedAt: Date.now()
  };
}

function getSocketPlayer(socket) {
  const playerId = socket.data.playerId;
  if (!playerId) {
    return null;
  }
  return players.get(playerId) || null;
}

function isAdminSocket(socket) {
  return socket.data.role === "admin" && isAdminTokenValid(socket.data.adminToken);
}

function isAdminTokenValid(token) {
  if (!token) {
    return false;
  }

  const expiresAt = adminTokens.get(token);
  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    adminTokens.delete(token);
    return false;
  }

  return true;
}

function cleanExpiredAdminTokens() {
  const now = Date.now();
  for (const [token, expiresAt] of adminTokens.entries()) {
    if (now > expiresAt) {
      adminTokens.delete(token);
    }
  }
}

function updateHeartbeatStatus() {
  const now = Date.now();
  let changed = false;
  for (const player of players.values()) {
    const isOnline = player.socketId && now - player.lastHeartbeat <= DISCONNECT_THRESHOLD;
    const wasOnline = player.online;
    player.online = Boolean(isOnline);
    if (wasOnline !== player.online) {
      changed = true;
    }
  }
  if (changed) {
    markStateDirty();
  }
}

function getElapsedMs() {
  if (!raceState.startedAt) {
    return 0;
  }

  if (raceState.status === "waiting") {
    return 0;
  }

  if (raceState.status === "paused" && raceState.pausedAt) {
    return Math.max(0, raceState.pausedAt - raceState.startedAt - raceState.totalPausedMs);
  }

  if (raceState.status === "ended" && raceState.endedAt) {
    return Math.max(0, raceState.endedAt - raceState.startedAt - raceState.totalPausedMs);
  }

  return Math.max(0, Date.now() - raceState.startedAt - raceState.totalPausedMs);
}

function getRemainingSeconds() {
  if (!raceState.startedAt) {
    return raceState.duration;
  }

  if (raceState.status === "paused" && raceState.remainingMsAtPause !== null) {
    return Math.max(0, Math.ceil(raceState.remainingMsAtPause / 1000));
  }

  if (raceState.status === "ended") {
    return 0;
  }

  const remainingMs = Math.max(0, raceState.duration * 1000 - getElapsedMs());
  return Math.ceil(remainingMs / 1000);
}

function getArticleProgressPercent(correctChars) {
  if (!raceState.articleContent) {
    return 0;
  }
  return roundNumber((correctChars / raceState.articleContent.length) * 100);
}

function getPlayerId(className, playerName) {
  return `${className}__${playerName}`;
}

function getClientIp(socket) {
  const trustedProxy = process.env.TRUST_PROXY === "true";
  const forwarded = trustedProxy ? socket.handshake.headers["x-forwarded-for"] : null;
  const rawIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded || socket.handshake.address || "").toString();
  return rawIp.replace(/^::ffff:/, "");
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(Math.max(Math.round(num), min), max);
}

function roundNumber(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
}

async function persistResults(snapshot) {
  await ensureStorage();
  const data = {
    savedAt: new Date().toISOString(),
    race: buildPublicRaceState(),
    leaderboard: snapshot
  };
  try {
    const tmp = resultFile + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, resultFile);
  } catch (err) {
    console.error("成绩落盘失败：", err.message);
  }
}

function buildCsv(snapshot) {
  const lines = [];
  lines.push("班级总分排行榜");
  lines.push("班级,排名,总分,参赛人数,有效人数");
  snapshot.classes.forEach((item) => {
    lines.push(
      [
        escapeCsv(item.className),
        item.rank,
        item.totalScore,
        item.playerCount,
        item.validPlayerCount
      ].join(",")
    );
  });

  lines.push("");
  lines.push("个人成绩排行榜");
  lines.push("姓名,班级,排名,速度(字/分钟),完成进度(%),准确率(%),得分,已输入字数,正确字数");
  snapshot.players.forEach((item) => {
    const csvProgress = raceState.articleContent.length > 0
      ? roundNumber((item.correctChars / raceState.articleContent.length) * 100)
      : 0;
    lines.push(
      [
        escapeCsv(item.playerName),
        escapeCsv(item.className),
        item.rank,
        item.speed,
        csvProgress,
        item.accuracy,
        item.score,
        item.typedLength,
        item.correctChars
      ].join(",")
    );
  });

  return lines.join("\n");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function normalizeStudentRows(rows) {
  return rows
    .map((item) => ({
      className: String(item?.className || "").trim(),
      playerName: String(item?.playerName || "").trim()
    }))
    .filter((item) => item.className && item.playerName);
}

function setStudentRoster(students) {
  const nextRoster = new Map();
  students.forEach(({ className, playerName }) => {
    if (!nextRoster.has(className)) {
      nextRoster.set(className, new Set());
    }
    nextRoster.get(className).add(playerName);
  });

  studentRoster = new Map(
    Array.from(nextRoster.entries()).map(([className, names]) => [
      className,
      Array.from(names).sort((a, b) => a.localeCompare(b, "zh-CN"))
    ])
  );

  rebuildClassList();
}

function rebuildClassList() {
  const rosterClasses = Array.from(studentRoster.keys()).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (rosterClasses.length > 0) {
    classList = rosterClasses;
  } else {
    classList = Array.from({ length: 6 }, (_, gradeIndex) =>
      Array.from({ length: 6 }, (_, classIndex) => `${gradeIndex + 1}年级${classIndex + 1}班`)
    ).flat();
  }
}

function setDefaultArticle() {
  if (articles.length > 0) {
    raceState.articleId = articles[0].id;
    raceState.articleTitle = articles[0].title;
    raceState.articleContent = articles[0].content;
  }
}

function getRosterNames(className) {
  return [...(studentRoster.get(className) || [])];
}

async function loadStudentRoster() {
  try {
    const raw = await fs.readFile(studentRosterFile, "utf8");
    const parsed = JSON.parse(raw);
    setStudentRoster(Array.isArray(parsed?.students) ? parsed.students : []);
  } catch (error) {
    studentRoster = new Map();
  }
}

async function persistStudentRoster() {
  await ensureStorage();
  const students = Array.from(studentRoster.entries()).flatMap(([className, names]) =>
    names.map((playerName) => ({ className, playerName }))
  );
  const tmp = studentRosterFile + ".tmp";
  await fs.writeFile(
    tmp,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        students
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.rename(tmp, studentRosterFile);
}

async function loadArticles() {
  try {
    const raw = await fs.readFile(articlesFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.customArticles)) {
      articles = [...BUILT_IN_ARTICLES, ...parsed.customArticles];
    } else {
      articles = [...BUILT_IN_ARTICLES];
    }
  } catch (_error) {
    articles = [...BUILT_IN_ARTICLES];
  }
}

async function persistArticles() {
  await ensureStorage();
  const customArticles = articles.filter((a) => !BUILT_IN_ARTICLES.some((b) => b.id === a.id));
  const tmp = articlesFile + ".tmp";
  await fs.writeFile(
    tmp,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        customArticles
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.rename(tmp, articlesFile);
}
