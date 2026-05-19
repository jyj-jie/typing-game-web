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
const vendorXlsxDir = path.join(__dirname, "node_modules", "xlsx", "dist");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = "admin123";
const DEFAULT_DURATION = 5 * 60;
const HEARTBEAT_INTERVAL = 2000;
const DISCONNECT_THRESHOLD = 5000;

const classList = Array.from({ length: 6 }, (_, gradeIndex) =>
  Array.from({ length: 6 }, (_, classIndex) => `${gradeIndex + 1}年级${classIndex + 1}班`)
).flat();

let articles = [
  {
    id: "article-1",
    title: "我们的校园",
    content: [
      "我们的校园很美。每天早晨，太阳刚刚升起，同学们就背着书包来到学校。校门口有两棵大树，树叶在风中轻轻地摇动。老师说，这两棵树已经在这里很多年了，它们每天都看着同学们上学和放学。走进校门，就能看到一个大操场。操场上有红色的跑道和绿色的草地。上体育课的时候，同学们在操场上跑步、跳绳、做游戏。操场旁边是教学楼，一共有五层。我们的教室在三楼，教室里很明亮，有四排整齐的课桌。墙上贴满了同学们的画和字，还有一张很大的中国地图。上课的时候，同学们认真地听老师讲课，一起读书，一起写字，一起做数学题。下课后，同学们有的去操场玩，有的在走廊上聊天，有的在教室里看课外书。学校里还有一个图书馆，里面有很多好看的书。每个星期三下午，老师会带同学们去图书馆看书。我最喜欢看科学书和故事书，每次都能学到新知识。学校食堂的饭菜也很好吃，有米饭、面条、饺子和各种蔬菜。中午休息的时候，同学们在教室里午休，为下午的课做好准备。下午放学时，同学们排好队走到校门口，和老师说再见。我们的校园就像一个温暖的大家庭，每天都有新的快乐和收获。在这里，我们学习知识，结交朋友，健康地成长。"
    ].join("")
  },
  {
    id: "article-2",
    title: "我爱大自然",
    content: [
      "我们生活的地球是一个美丽的地方。春天，小草从土里钻出来，花儿开了，红的、黄的、白的，五颜六色。小鸟在树枝上唱歌，蝴蝶在花丛中飞来飞去。农民伯伯在田里种下种子，等着秋天收获。夏天，天气很热，知了在树上叫个不停。大树长满了绿油油的叶子，像一把把大伞。小朋友们吃着西瓜和冰淇淋，在树荫下玩耍。池塘里的荷花开了一片，粉色的花瓣非常好看。有时候下大雨，雨后的天空会出现一道彩虹。秋天到了，天气变得凉爽。树叶变成了红色和黄色，一片一片从树上落下来。田野里，稻谷金黄金黄的，农民伯伯忙着收割。果园里，苹果红了，梨子黄了，葡萄紫了，到处都是丰收的景象。冬天，天气很冷，北风呼呼地吹。有时候会下雪，大地一片白，像穿上了新衣服。小朋友们不怕冷，在雪地里堆雪人、打雪仗，玩得很开心。一年四季，大自然都给我们不同的礼物。春天的花，夏天的雨，秋天的果实，冬天的雪，都是美好的。我们每个人都要爱护大自然，不乱扔垃圾，不伤害小动物，多种树多种花。只有保护好环境，地球才能一直美丽下去，我们的孩子也能看到蓝蓝的天、清清的水。"
    ].join("")
  },
  {
    id: "article-3",
    title: "快乐的一天",
    content: [
      "星期天的早晨，阳光照进我的房间。我早早地起了床，因为今天爸爸妈妈要带我去公园玩。吃过早饭后，我穿上最喜欢的运动鞋，背着小背包就出发了。公园离我家不远，走了十几分钟就到了。公园里人很多，有的老人在打太极拳，有的叔叔阿姨在跑步，还有好多小朋友在草地上玩耍。我们先去了湖边，湖水很清，能看到小鱼在水里游来游去。爸爸给我买了一些鱼食，我把鱼食撒到水里，小鱼们马上围过来抢着吃，样子可爱极了。湖面上还有几只白天鹅，它们悠闲地游着，有时低下头喝喝水，有时展开翅膀动一动。看完小鱼和天鹅，我们走到游乐区。游乐区有滑滑梯，有秋千，还有旋转木马。我最喜欢坐旋转木马，选了一匹白色的小马，坐上之后木马随着音乐转了起来。一上一下的感觉真好玩，我笑着向爸爸妈妈招手。从旋转木马下来，我们又一起去坐了小火车。小火车绕公园跑了一圈，沿途看到了花坛、喷泉和小桥。下了小火车，我在草地上跑了一会儿，追着泡泡玩，爸爸吹出来的泡泡在阳光下闪闪发光。玩累了，妈妈铺好垫子，我们坐在草地上吃零食。妈妈带了面包、水果和饼干。我一边吃东西，一边看天上的云朵。云朵白白的，有的像小狗，有的像棉花糖。吃完东西，我们又在公园里散步。花坛里的花儿开得正好，有月季、百合，还有许多我叫不出名字的小花。蜜蜂在花丛中忙碌地采蜜。时间过得真快，太阳慢慢往西边落下去了。爸爸说该回家了，我有点舍不得走，但想到今天过得这么开心，心里又觉得很满足。回家的路上，我一直回想着这一天的快乐时光。"
    ].join("")
  }
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const players = new Map();
const adminTokens = new Map();
let studentRoster = new Map();
let finalSnapshot = null;

const raceState = {
  status: "waiting",
  duration: DEFAULT_DURATION,
  articleId: articles[0].id,
  articleTitle: articles[0].title,
  articleContent: articles[0].content,
  startedAt: null,
  pausedAt: null,
  endedAt: null,
  totalPausedMs: 0,
  remainingMsAtPause: null,
  endReason: ""
};

app.use(express.json());
app.use("/vendor/xlsx", express.static(vendorXlsxDir));
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.redirect("/player.html");
});

app.get("/api/config", (req, res) => {
  res.json({
    classes: classList,
    defaultDuration: DEFAULT_DURATION,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    disconnectThreshold: DISCONNECT_THRESHOLD,
    adminPasswordHint: "默认密码已内置，可在 server.js 中修改"
  });
});

app.get("/api/articles", (req, res) => {
  res.json({
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      content: article.content
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

  setStudentRoster(students);
  await persistStudentRoster();
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
  await persistStudentRoster();
  return res.json({ success: true, message: "学生名单已清除" });
});

app.post("/api/articles", (req, res) => {
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

  if (content.length < 100) {
    return res.status(400).json({
      success: false,
      message: "文章内容过短，请导入更完整的比赛文章"
    });
  }

  const article = {
    id: `article-${Date.now()}`,
    title,
    content
  };

  articles = [...articles, article];
  return res.json({
    success: true,
    article,
    message: "比赛文章导入成功"
  });
});

app.delete("/api/articles/:id", (req, res) => {
  const token = String(req.query.token || "");
  if (!isAdminTokenValid(token)) {
    return res.status(401).json({ success: false, message: "管理员身份无效" });
  }

  const articleId = req.params.id;
  const target = articles.find((a) => a.id === articleId);
  if (!target) {
    return res.status(404).json({ success: false, message: "文章不存在" });
  }

  if (target.id === "article-1" || target.id === "article-2" || target.id === "article-3") {
    return res.status(400).json({ success: false, message: "内置文章不可删除" });
  }

  articles = articles.filter((a) => a.id !== articleId);
  return res.json({ success: true, message: "已删除文章" });
});

app.get("/api/state", (req, res) => {
  res.json({
    race: buildPublicRaceState(),
    leaderboard: getCurrentSnapshot(),
    players: buildPlayerAdminRows()
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
  socket.emit("raceStateSync", {
    race: buildPublicRaceState(),
    leaderboard: getCurrentSnapshot()
  });

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

      if (!existingPlayer && raceLocked) {
        callback({ success: false, message: "比赛已开始，暂不允许新增选手" });
        return;
      }

      if (existingPlayer && existingPlayer.online && existingPlayer.socketId !== socket.id) {
        callback({ success: false, message: "该选手已在其他设备登录" });
        return;
      }

      const ip = getClientIp(socket);
      let player = existingPlayer;

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

    player.online = true;
    player.lastHeartbeat = Date.now();
  });

  socket.on("updateProgress", (payload = {}) => {
    const player = getSocketPlayer(socket);
    if (!player || raceState.status !== "running") {
      return;
    }

    const articleLength = raceState.articleContent.length;
    const totalKeystrokes = clampNumber(payload.totalKeystrokes, 0, 999999);
    const errorKeystrokes = clampNumber(payload.errorKeystrokes, 0, totalKeystrokes);
    const correctChars = clampNumber(payload.correctChars, 0, articleLength);
    const backspaceCount = clampNumber(payload.backspaceCount, 0, 999999);
    const warningCount = clampNumber(payload.warningCount, 0, 999);
    const typedLength = clampNumber(payload.typedLength, 0, articleLength * 2);

    player.online = true;
    player.lastHeartbeat = Date.now();
    player.stats.totalKeystrokes = totalKeystrokes;
    player.stats.errorKeystrokes = errorKeystrokes;
    player.stats.correctChars = correctChars;
    player.stats.backspaceCount = backspaceCount;
    player.stats.warningCount = warningCount;
    player.stats.typedLength = typedLength;
    player.stats.currentInput = String(payload.currentInput || "").slice(0, articleLength * 2);
    player.stats.updatedAt = Date.now();

    emitAllStates();
  });

  socket.on("reportFocusWarning", () => {
    return;
  });

  socket.on("reportShortcutWarning", () => {
    return;
  });

  socket.on("adminStartRace", (payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权开始比赛" });
      return;
    }

    if (raceState.status === "running" || raceState.status === "paused") {
      callback({ success: false, message: "比赛正在进行中" });
      return;
    }

    const article = articles.find((item) => item.id === payload?.articleId) || articles[0];
    const duration = clampNumber(payload?.duration, 60, 1800);
    if (players.size === 0) {
      callback({ success: false, message: "请至少先让 1 名学生登录后再开始比赛" });
      return;
    }

    finalSnapshot = null;
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
  });

  socket.on("adminPauseRace", (_payload, callback = () => {}) => {
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
  });

  socket.on("adminResumeRace", (_payload, callback = () => {}) => {
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
  });

  socket.on("adminEndRace", (_payload, callback = () => {}) => {
    if (!isAdminSocket(socket)) {
      callback({ success: false, message: "无权结束比赛" });
      return;
    }

    finalizeRace("manual")
      .then(() => callback({ success: true, message: "比赛已结束" }))
      .catch(() => callback({ success: false, message: "结束比赛失败" }));
  });

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
  updateHeartbeatStatus();

  if (raceState.status === "running" && getRemainingSeconds() <= 0) {
    await finalizeRace("timeout");
    return;
  }

  emitAllStates();
}, 1000);

ticker.unref();

server.listen(PORT, async () => {
  await ensureStorage();
  await loadStudentRoster();
  console.log(`打字比赛系统已启动：http://localhost:${PORT}`);
  console.log(`局域网访问地址：http://本机IP:${PORT}`);
});

async function finalizeRace(reason) {
  if (raceState.status === "ended" || raceState.status === "waiting") {
    return;
  }

  if (raceState.status === "paused" && raceState.pausedAt) {
    raceState.endedAt = raceState.pausedAt;
  } else {
    raceState.endedAt = Date.now();
  }

  raceState.status = "ended";
  raceState.endReason = reason;

  finalSnapshot = buildLeaderboardSnapshot();
  await persistResults(finalSnapshot);

  io.emit("raceEnd", {
    reason,
    race: buildPublicRaceState(),
    leaderboard: finalSnapshot
  });

  emitAllStates();
}

function emitAllStates() {
  const publicRace = buildPublicRaceState();
  const snapshot = getCurrentSnapshot();
  const playerRows = buildPlayerAdminRows();

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

  for (const player of players.values()) {
    if (!player.socketId) {
      continue;
    }

    const selfResult = snapshot.players.find((item) => item.id === player.id) || null;
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
      disqualifyReason: metrics.disqualifyReason
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

function buildPlayerAdminRows() {
  const snapshot = getCurrentSnapshot();
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
        accuracy: metrics?.accuracy || 0,
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
    warningCount: player.stats.warningCount,
    shortcutWarnings: player.stats.shortcutWarnings,
    totalKeystrokes: player.stats.totalKeystrokes,
    errorKeystrokes: player.stats.errorKeystrokes,
    correctChars: player.stats.correctChars,
    backspaceCount: player.stats.backspaceCount,
    typedLength: player.stats.typedLength,
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
  const safeElapsedMs = Math.max(elapsedMs, 1000);
  const minutes = safeElapsedMs / 60000;
  const speed = player.stats.correctChars > 0 ? player.stats.correctChars / minutes : 0;
  const accuracyDecimal =
    player.stats.totalKeystrokes > 0
      ? Math.max(
          0,
          (player.stats.totalKeystrokes - player.stats.errorKeystrokes) / player.stats.totalKeystrokes
        )
      : 1;

  const articleLength = raceState.articleContent.length || 1;
  const completionRatio = Math.min(player.stats.correctChars / articleLength, 1);
  const completionScore = completionRatio * 60;
  const speedScore = Math.min(speed / 12, 1) * 50;
  const accuracyScore = accuracyDecimal * 40;
  const score = completionScore + speedScore + accuracyScore;
  const disqualified = false;
  const disqualifyReason = "";

  return {
    speed: roundNumber(speed),
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
  for (const player of players.values()) {
    const isOnline = player.socketId && now - player.lastHeartbeat <= DISCONNECT_THRESHOLD;
    player.online = Boolean(isOnline);
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
  const forwarded = socket.handshake.headers["x-forwarded-for"];
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
  await fs.writeFile(resultFile, JSON.stringify(data, null, 2), "utf8");
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
  lines.push("姓名,班级,排名,速度(字/分钟),准确率(%),得分,已输入字数,正确字数");
  snapshot.players.forEach((item) => {
    lines.push(
      [
        escapeCsv(item.playerName),
        escapeCsv(item.className),
        item.rank,
        item.speed,
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
    .filter((item) => classList.includes(item.className) && item.playerName);
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
  await fs.writeFile(
    studentRosterFile,
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
}
