(() => {
  const STORAGE_KEY = "nur_oral_care_v1";

  const byId = (id) => document.getElementById(id);
  const on = (el, event, handler) => {
    if (!el) return;
    el.addEventListener(event, handler);
  };

  const page = document.body?.dataset?.page || "";

  const TASKS = [
    { key: "brushAM", title: "Чистка утром", meta: "2 минуты", points: 10 },
    { key: "brushPM", title: "Чистка вечером", meta: "перед сном", points: 10 },
    { key: "floss", title: "Нить / ёршик", meta: "межзубная чистка", points: 10 },
    { key: "rinse", title: "Ополаскиватель", meta: "по желанию", points: 5 },
  ];

  const ADVICE_COST = 20;

  /** @type {{ auth?: { loggedIn: boolean, method?: 'email'|'phone', id?: string, passHash?: string }, profile: null | {name?: string, iin?: string, age?: number}, history: Array<any>, daily: Record<string, any>, ui?: { homeMonth?: string, theme?: string, authMethod?: 'email'|'phone', authMode?: 'login'|'register' }, wallet?: { balance: number } }} */
  let state = loadState();
  migrateState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { auth: { loggedIn: false }, profile: null, history: [], daily: {}, ui: {}, wallet: { balance: 0 } };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { auth: { loggedIn: false }, profile: null, history: [], daily: {}, ui: {}, wallet: { balance: 0 } };
      return {
        auth: parsed.auth && typeof parsed.auth === "object" ? parsed.auth : { loggedIn: false },
        profile: parsed.profile ?? null,
        history: Array.isArray(parsed.history) ? parsed.history : [],
        daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
        ui: parsed.ui && typeof parsed.ui === "object" ? parsed.ui : {},
        wallet: parsed.wallet && typeof parsed.wallet === "object" ? parsed.wallet : undefined,
      };
    } catch {
      return { auth: { loggedIn: false }, profile: null, history: [], daily: {}, ui: {}, wallet: { balance: 0 } };
    }
  }

  function ensureAuth() {
    if (!state.auth || typeof state.auth !== "object") state.auth = { loggedIn: false };
    if (typeof state.auth.loggedIn !== "boolean") state.auth.loggedIn = false;
  }

  function isAuthed() {
    ensureAuth();
    return Boolean(state.auth.loggedIn);
  }

  function ensureWallet() {
    if (!state.wallet || typeof state.wallet !== "object") state.wallet = { balance: 0 };
    if (!Number.isFinite(state.wallet.balance)) state.wallet.balance = 0;
    if (state.wallet.balance < 0) state.wallet.balance = 0;
  }

  function getWalletBalance() {
    ensureWallet();
    return state.wallet.balance;
  }

  function migrateState() {
    ensureAuth();
    // Wallet migration: previously points were derived; now keep an explicit wallet balance.
    ensureWallet();

    // Backfill awardedPoints so future deltas are stable.
    for (const key of Object.keys(state.daily || {})) {
      const log = state.daily?.[key];
      if (!log || typeof log !== "object") continue;
      if (!log.tasks || typeof log.tasks !== "object") log.tasks = {};
      if (!Number.isFinite(log.awardedPoints)) {
        log.awardedPoints = dayPointsFromTasks(log.tasks);
      }
      if (typeof log.note !== "string") {
        // leave undefined (smaller storage); only set when user adds a note
        delete log.note;
      }
    }

    // Wallet init: if coming from an older build, start wallet from earned task points ONCE.
    // After that, keep wallet persistent because users can spend points (e.g., on advice).
    state.ui = state.ui || {};
    const total = calcTotalPoints();
    if (!state.ui.walletInitialized) {
      state.wallet.balance = total;
      state.ui.walletInitialized = true;
    }
    saveState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function getInitialTheme() {
    const saved = state.ui?.theme;
    if (saved === "dark" || saved === "light") return saved;
    const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    return prefersDark ? "dark" : "light";
  }

  function applyTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    state.ui = state.ui || {};
    state.ui.theme = t;
    saveState();
    updateThemeToggle();
  }

  function updateThemeToggle() {
    const btn = byId("themeToggle");
    if (!btn) return;
    const t = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    btn.textContent = t === "dark" ? "🌙" : "☀️";
    btn.setAttribute("aria-pressed", String(t === "dark"));
    btn.setAttribute("aria-label", t === "dark" ? "Тёмная тема" : "Светлая тема");
    btn.title = t === "dark" ? "Тёмная тема" : "Светлая тема";
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function renderHeader() {
    const badge = byId("userBadge");
    const balance = getWalletBalance();
    if (badge && isAuthed()) {
      badge.hidden = false;
      const label = state.profile?.name ? state.profile.name : state.auth?.id ? state.auth.id : "Пользователь";
      badge.textContent = `${label} • ${balance}`;
    } else if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }

    // active nav
    const navLinks = document.querySelectorAll("a[data-nav]");
    for (const a of navLinks) {
      const key = a.getAttribute("data-nav");
      if (key && key === page) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  function normalizeDigits(s) {
    return String(s || "").replace(/\D+/g, "");
  }

  function isValidIin(iin) {
    const d = normalizeDigits(iin);
    return /^\d{12}$/.test(d);
  }

  function safeNextFromLocation() {
    // Allowlist of internal pages only
    const allowed = new Set(["index.html", "profile.html", "survey.html", "history.html"]);
    try {
      const params = new URLSearchParams(location.search);
      const n = params.get("next");
      if (n && allowed.has(n)) return n;
    } catch {
      // ignore
    }
    const path = (location.pathname || "").split("/").pop() || "index.html";
    if (allowed.has(path)) return path;
    return "index.html";
  }

  function requireAuthOrRedirect() {
    if (page === "home") return false;
    if (isAuthed()) return false;
    const next = safeNextFromLocation();
    location.replace(`./index.html?next=${encodeURIComponent(next)}`);
    return true;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(d) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function monthKey(d) {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    return `${y}-${m}`;
  }

  function getDayLog(key) {
    if (!state.daily[key] || typeof state.daily[key] !== "object") {
      state.daily[key] = { tasks: {}, updatedAt: new Date().toISOString(), awardedPoints: 0 };
    }
    if (!state.daily[key].tasks || typeof state.daily[key].tasks !== "object") {
      state.daily[key].tasks = {};
    }
    if (!Number.isFinite(state.daily[key].awardedPoints)) {
      state.daily[key].awardedPoints = dayPointsFromTasks(state.daily[key].tasks);
    }
    return state.daily[key];
  }

  function dayPointsFromTasks(tasks) {
    let points = 0;
    let doneCount = 0;
    for (const t of TASKS) {
      if (tasks?.[t.key]) {
        points += t.points;
        doneCount++;
      }
    }
    const bothBrush = Boolean(tasks?.brushAM) && Boolean(tasks?.brushPM);
    const all = doneCount === TASKS.length;
    if (bothBrush) points += 10;
    if (all) points += 10;
    return points;
  }

  function dayStatus(tasks) {
    const done = TASKS.reduce((acc, t) => acc + (tasks?.[t.key] ? 1 : 0), 0);
    if (!done) return "none";
    const both = Boolean(tasks?.brushAM) && Boolean(tasks?.brushPM);
    if (done === TASKS.length) return "perfect";
    if (both) return "good";
    return "part";
  }

  function calcTotalPoints() {
    let total = 0;
    for (const key of Object.keys(state.daily || {})) {
      const log = state.daily[key];
      total += dayPointsFromTasks(log?.tasks);
    }
    return total;
  }

  function applyWalletDelta(delta) {
    if (!delta) return;
    ensureWallet();
    const next = state.wallet.balance + delta;
    state.wallet.balance = next < 0 ? 0 : next;
  }

  function calcStreak() {
    // streak counts consecutive days where both brushes are done
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 3650; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dateKey(d);
      const tasks = state.daily?.[key]?.tasks;
      const ok = Boolean(tasks?.brushAM) && Boolean(tasks?.brushPM);
      if (!ok) break;
      streak++;
    }
    return streak;
  }

  function setMsg(text) {
    const msg = byId("surveyMsg");
    if (!msg) return;
    if (!text) {
      msg.hidden = true;
      msg.textContent = "";
      return;
    }
    msg.hidden = false;
    msg.textContent = text;
  }

  function getSurveyFromForm() {
    const questionInput = byId("questionInput");
    const brushingInput = byId("brushingInput");
    const flossInput = byId("flossInput");
    const mouthwashInput = byId("mouthwashInput");
    const sugarInput = byId("sugarInput");
    const bleedingInput = byId("bleedingInput");
    const sensitivityInput = byId("sensitivityInput");
    const smokeInput = byId("smokeInput");
    const dentistInput = byId("dentistInput");
    const goalInput = byId("goalInput");

    return {
      question: (questionInput?.value || "").trim(),
      brushingPerDay: Number(brushingInput?.value ?? 2),
      floss: flossInput?.value ?? "sometimes",
      mouthwash: mouthwashInput?.value ?? "no",
      sugar: sugarInput?.value ?? "medium",
      bleeding: bleedingInput?.value ?? "no",
      sensitivity: sensitivityInput?.value ?? "none",
      smoke: smokeInput?.value ?? "no",
      dentistMonths: !dentistInput || dentistInput.value === "" ? null : Number(dentistInput.value),
      goal: goalInput?.value ?? "prevent",
    };
  }

  function normalizeText(s) {
    return (s || "").toLowerCase();
  }

  function generateAdvice({ profile, survey }) {
    const tips = [];
    const next = [];
    const warnings = [];

    // Base routine
    tips.push("Чистите зубы 2 раза в день по 2 минуты мягкой щёткой.");
    tips.push("Используйте фторсодержащую пасту; не полощите рот водой сразу после чистки (только сплюньте) — так фтор работает лучше.");

    if (survey.brushingPerDay < 2) {
      tips.push("Повысьте частоту чистки до 2 раз в день: утром и перед сном.");
      next.push("Поставьте напоминание на 2 недели и отслеживайте привычку.");
    }

    if (survey.floss === "no") {
      tips.push("Добавьте нить или межзубные ёршики 1 раз в день — это снижает риск кариеса между зубами и воспаления дёсен.");
      next.push("Начните с 3–4 раз в неделю, затем ежедневно.");
    } else if (survey.floss === "sometimes") {
      tips.push("Стабилизируйте нить/ёршики до 1 раза в день (лучше вечером).");
    }

    if (survey.sugar === "high") {
      tips.push("Сократите частые перекусы сладким/газировкой — это один из главных факторов кариеса.");
      tips.push("Если сладкое было — лучше запить водой и подождать 30 минут перед чисткой.");
      next.push("Ограничьте сладкие напитки до 1 раза в день или реже.");
    }

    if (survey.mouthwash === "yes") {
      tips.push("Если используете ополаскиватель, выбирайте без спирта; при кровоточивости лучше обсудить антисептики со стоматологом.");
    }

    if (survey.bleeding === "sometimes" || survey.bleeding === "often") {
      tips.push("При кровоточивости: чистите мягко, но регулярно; уделяйте внимание линии дёсен.");
      tips.push("Добавьте межзубную чистку (нить/ёршики) — часто кровоточивость связана с налётом между зубами.");
      next.push("Если кровоточивость сохраняется > 7–10 дней при хорошей гигиене — запишитесь на осмотр и профессиональную чистку.");
    }

    if (survey.sensitivity === "mild" || survey.sensitivity === "strong") {
      tips.push("При чувствительности используйте пасту для чувствительных зубов курсом 2–4 недели и мягкую щётку.");
      tips.push("Избегайте слишком сильного нажима и абразивных паст.");
      next.push("Если чувствительность сильная/на горячее/самопроизвольная — проверьтесь у стоматолога.");
    }

    if (survey.smoke === "yes") {
      tips.push("Курение повышает риск воспаления дёсен и налёта; по возможности сокращайте/отказывайтесь.");
      next.push("План: уменьшить количество сигарет на 10–20% на этой неделе.");
    }

    if (typeof survey.dentistMonths === "number") {
      if (survey.dentistMonths >= 12) {
        next.push("Плановый осмотр обычно раз в 6–12 месяцев — имеет смысл записаться.");
      } else {
        next.push("Если осмотр был недавно — продолжайте регулярность (6–12 месяцев)." );
      }
    } else {
      next.push("Если давно не были у стоматолога — плановый осмотр раз в 6–12 месяцев." );
    }

    // Goal-specific
    switch (survey.goal) {
      case "gum":
        tips.push("Цель ‘здоровье дёсен’: особенно важны межзубная чистка и аккуратная техника у линии дёсен.");
        break;
      case "fresh":
        tips.push("Цель ‘свежее дыхание’: чистите язык (скребком или щёткой) и пейте достаточно воды.");
        tips.push("Если запах держится несмотря на гигиену — причина может быть в дёснах/камне или ЛОР/ЖКТ, стоит проверить." );
        break;
      case "white":
        tips.push("Цель ‘осветление’: избегайте частого кофе/чая/табачного налёта; безопаснее начинать с профчистки у стоматолога.");
        tips.push("Домашние ‘кислотные’ лайфхаки (лимон/сода) лучше не использовать — они повреждают эмаль.");
        break;
      case "sensitivity":
        tips.push("Цель ‘уменьшить чувствительность’: мягкая техника чистки + паста для чувствительных — базовый безопасный старт.");
        break;
      default:
        tips.push("Цель ‘профилактика’: регулярность + межзубная чистка + меньше сахара дают лучший эффект." );
        break;
    }

    // Question heuristics
    const q = normalizeText(survey.question);
    if (q) {
      if (q.includes("кров") || q.includes("кровоточ")) {
        warnings.push("Если кровь обильная или появилась внезапно с болью/отёком — лучше обратиться к врачу быстрее.");
      }
      if (q.includes("отек") || q.includes("опух") || q.includes("припух")) {
        warnings.push("Отёк дёсен/лица может быть признаком инфекции — не затягивайте с осмотром." );
      }
      if (q.includes("гной") || q.includes("абсцесс")) {
        warnings.push("Гной/абсцесс — повод срочно к стоматологу." );
      }
      if (q.includes("температ") || q.includes("лихорад")) {
        warnings.push("Температура на фоне зубной боли/отёка — повод для срочной консультации." );
      }
      if (q.includes("сильн") && q.includes("боль")) {
        warnings.push("Сильная боль, которая мешает спать, — лучше не откладывать визит." );
      }
      if (q.includes("брекет") || q.includes("элайнер")) {
        tips.push("С брекетами/элайнерами особенно важны ёршики и тщательная чистка вокруг элементов.");
      }
    }

    // Personalization touch
    if (profile?.name) {
      tips.unshift(`${profile.name}, вот план улучшения на ближайшие 2–4 недели:`);
    }

    // Deduplicate
    const uniq = (arr) => Array.from(new Set(arr));
    return { tips: uniq(tips), next: uniq(next), warnings: uniq(warnings) };
  }

  function setList(ul, items) {
    ul.textContent = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
  }

  function showAdvice(advice) {
    const adviceEmpty = byId("adviceEmpty");
    const adviceBlock = byId("adviceBlock");
    const tipsList = byId("tipsList");
    const nextList = byId("nextList");
    const warningBlock = byId("warningBlock");
    const warningsList = byId("warningsList");

    if (!adviceEmpty || !adviceBlock || !tipsList || !nextList) return;

    adviceEmpty.hidden = true;
    adviceBlock.hidden = false;

    setList(tipsList, advice.tips);
    setList(nextList, advice.next);

    if (warningBlock && warningsList) {
      if (advice.warnings.length) {
        warningBlock.hidden = false;
        setList(warningsList, advice.warnings);
      } else {
        warningBlock.hidden = true;
        warningsList.textContent = "";
      }
    }
  }

  function renderHistory() {
    const historyList = byId("historyList");
    const historyEmpty = byId("historyEmpty");
    if (!historyList || !historyEmpty) return;

    const items = state.history.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    historyList.textContent = "";

    if (!items.length) {
      historyEmpty.hidden = false;
      return;
    }

    historyEmpty.hidden = true;

    for (const entry of items) {
      const wrap = document.createElement("div");
      wrap.className = "entry";

      const head = document.createElement("div");
      head.className = "entryHead";

      const left = document.createElement("div");

      const title = document.createElement("div");
      title.className = "entryTitle";
      title.textContent = entry.question ? `Запрос: ${entry.question}` : "Опрос без вопроса";

      const meta = document.createElement("div");
      meta.className = "entryMeta";
      meta.textContent = fmtDate(entry.createdAt);

      left.appendChild(title);
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "entryActions";

      const openBtn = document.createElement("a");
      openBtn.className = "linkBtn";
      openBtn.href = `./survey.html?entry=${encodeURIComponent(entry.id)}`;
      openBtn.textContent = "Открыть";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "linkBtn";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", () => {
        state.history = state.history.filter((x) => x.id !== entry.id);
        saveState();
        renderHistory();
      });

      actions.appendChild(openBtn);
      actions.appendChild(delBtn);

      head.appendChild(left);
      head.appendChild(actions);

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Показать детали";
      details.appendChild(summary);

      const block = document.createElement("div");
      block.style.marginTop = "8px";

      const small = document.createElement("div");
      small.className = "muted small";
      small.textContent = "Ответы опроса:";

      const pre = document.createElement("pre");
      pre.className = "preBlock";
      pre.textContent = formatSurvey(entry.survey);

      const small2 = document.createElement("div");
      small2.className = "muted small";
      small2.style.marginTop = "10px";
      small2.textContent = "Рекомендации:";

      const ul = document.createElement("ul");
      ul.className = "list";
      for (const t of entry.advice.tips) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.appendChild(li);
      }

      block.appendChild(small);
      block.appendChild(pre);
      block.appendChild(small2);
      block.appendChild(ul);

      details.appendChild(block);

      wrap.appendChild(head);
      wrap.appendChild(details);

      historyList.appendChild(wrap);
    }
  }

  function labelMap(key, value) {
    const maps = {
      floss: { no: "нет", sometimes: "иногда", yes: "да" },
      mouthwash: { no: "нет", yes: "да" },
      sugar: { low: "редко", medium: "иногда", high: "часто" },
      bleeding: { no: "нет", sometimes: "иногда", often: "часто" },
      sensitivity: { none: "нет", mild: "лёгкая", strong: "сильная" },
      smoke: { no: "нет", yes: "да" },
      goal: {
        prevent: "профилактика кариеса",
        gum: "здоровье дёсен",
        fresh: "свежее дыхание",
        white: "осветление эмали",
        sensitivity: "уменьшить чувствительность",
      },
    };
    return maps[key]?.[value] ?? value;
  }

  function formatSurvey(s) {
    const lines = [];
    if (s.question) lines.push(`Вопрос: ${s.question}`);
    lines.push(`Чистка/день: ${s.brushingPerDay}`);
    lines.push(`Нить/ёршики: ${labelMap("floss", s.floss)}`);
    lines.push(`Ополаскиватель: ${labelMap("mouthwash", s.mouthwash)}`);
    lines.push(`Сладкое/газировка: ${labelMap("sugar", s.sugar)}`);
    lines.push(`Кровоточивость: ${labelMap("bleeding", s.bleeding)}`);
    lines.push(`Чувствительность: ${labelMap("sensitivity", s.sensitivity)}`);
    lines.push(`Курение: ${labelMap("smoke", s.smoke)}`);
    lines.push(`Стоматолог (мес. назад): ${typeof s.dentistMonths === "number" ? s.dentistMonths : "—"}`);
    lines.push(`Цель: ${labelMap("goal", s.goal)}`);
    return lines.join("\n");
  }

  function applySurveyToForm(s) {
    const questionInput = byId("questionInput");
    const brushingInput = byId("brushingInput");
    const flossInput = byId("flossInput");
    const mouthwashInput = byId("mouthwashInput");
    const sugarInput = byId("sugarInput");
    const bleedingInput = byId("bleedingInput");
    const sensitivityInput = byId("sensitivityInput");
    const smokeInput = byId("smokeInput");
    const dentistInput = byId("dentistInput");
    const goalInput = byId("goalInput");

    if (questionInput) questionInput.value = s.question ?? "";
    if (brushingInput) brushingInput.value = String(s.brushingPerDay ?? 2);
    if (flossInput) flossInput.value = s.floss ?? "sometimes";
    if (mouthwashInput) mouthwashInput.value = s.mouthwash ?? "no";
    if (sugarInput) sugarInput.value = s.sugar ?? "medium";
    if (bleedingInput) bleedingInput.value = s.bleeding ?? "no";
    if (sensitivityInput) sensitivityInput.value = s.sensitivity ?? "none";
    if (smokeInput) smokeInput.value = s.smoke ?? "no";
    if (dentistInput) dentistInput.value = typeof s.dentistMonths === "number" ? String(s.dentistMonths) : "";
    if (goalInput) goalInput.value = s.goal ?? "prevent";
  }

  function initCommon() {
    // Theme
    applyTheme(getInitialTheme());
    on(byId("themeToggle"), "click", () => {
      const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    });

    // Auth gate
    if (requireAuthOrRedirect()) return true;

    renderHeader();
    on(byId("resetAllBtn"), "click", () => {
      state = { auth: { loggedIn: false }, profile: null, history: [], daily: {}, ui: {}, wallet: { balance: 0 } };
      saveState();
      // best-effort reset
      const profileForm = byId("profileForm");
      const surveyForm = byId("surveyForm");
      profileForm?.reset?.();
      surveyForm?.reset?.();
      const adviceEmpty = byId("adviceEmpty");
      const adviceBlock = byId("adviceBlock");
      if (adviceEmpty) adviceEmpty.hidden = false;
      if (adviceBlock) adviceBlock.hidden = true;
      renderHeader();
      renderHistory();
      setMsg("");
    });

    return false;
  }

  function initHomePage() {
    const homeHeader = byId("homeHeader");
    const greeting = byId("homeGreeting");
    const balanceEl = byId("homeBalance");
    const streakEl = byId("homeStreak");
    const authSection = byId("authSection");
    const homeApp = byId("homeApp");
    const authForm = byId("authForm");
    const authTabEmail = byId("authTabEmail");
    const authTabPhone = byId("authTabPhone");
    const authIcon = byId("authIcon");
    const authTitle = byId("authTitle");
    const authSub = byId("authSub");
    const emailField = byId("emailField");
    const phoneField = byId("phoneField");
    const authEmailInput = byId("authEmailInput");
    const authPhoneInput = byId("authPhoneInput");
    const authPasswordInput = byId("authPasswordInput");
    const pwToggle = byId("pwToggle");
    const forgotBtn = byId("forgotBtn");
    const authExtra = byId("authExtra");
    const authAgeInput = byId("authAgeInput");
    const authIinInput = byId("authIinInput");
    const authSubmitBtn = byId("authSubmitBtn");
    const authMsg = byId("authMsg");
    const authSwitchBtn = byId("authSwitchBtn");
    const authSwitchText = byId("authSwitchText");
    const nav = document.querySelector("nav.nav");
    const badge = byId("userBadge");
    const reset = byId("resetAllBtn");
    const todayMeta = byId("todayMeta");
    const todayTasks = byId("todayTasks");
    const todayProgress = byId("todayProgress");
    const todayBonus = byId("todayBonus");
    const todayResetBtn = byId("todayResetBtn");
    const calMonth = byId("calMonth");
    const calGrid = byId("calGrid");
    const calPrev = byId("calPrev");
    const calNext = byId("calNext");

    function setAuthMsg(text, kind = "info") {
      if (!authMsg) return;
      if (!text) {
        authMsg.hidden = true;
        authMsg.textContent = "";
        authMsg.classList.remove("success", "error", "animate");
        return;
      }
      authMsg.hidden = false;
      authMsg.textContent = text;
      authMsg.classList.remove("success", "error", "animate");
      if (kind === "success") authMsg.classList.add("success");
      if (kind === "error") authMsg.classList.add("error");
    }

    function playAuthSuccess(text) {
      if (!authMsg) return Promise.resolve();
      setAuthMsg(text, "success");
      // restart animation
      authMsg.classList.remove("animate");
      // eslint-disable-next-line no-unused-expressions
      authMsg.offsetWidth;
      authMsg.classList.add("animate");
      return new Promise((resolve) => setTimeout(resolve, 650));
    }

    function getAuthUi() {
      state.ui = state.ui || {};
      const method = state.ui.authMethod === "phone" ? "phone" : "email";
      const mode = state.ui.authMode === "register" ? "register" : "login";
      return { method, mode };
    }

    function setAuthUi(patch) {
      state.ui = state.ui || {};
      if (patch.method) state.ui.authMethod = patch.method;
      if (patch.mode) state.ui.authMode = patch.mode;
      saveState();
    }

    function renderAuthUi() {
      const { method, mode } = getAuthUi();

      if (authTabEmail) authTabEmail.setAttribute("aria-selected", String(method === "email"));
      if (authTabPhone) authTabPhone.setAttribute("aria-selected", String(method === "phone"));
      if (emailField) emailField.hidden = method !== "email";
      if (phoneField) phoneField.hidden = method !== "phone";
      if (authExtra) authExtra.hidden = mode !== "register";

      if (authTitle) authTitle.textContent = mode === "register" ? (method === "email" ? "Регистрация через Email" : "Регистрация через Телефон") : (method === "email" ? "Вход через Email" : "Вход через Телефон");
      if (authSub) authSub.textContent = mode === "register" ? "Создайте аккаунт" : `Войдите с помощью ${method === "email" ? "email" : "телефона"} и пароля`;
      if (authIcon) authIcon.textContent = method === "email" ? "✉" : "📱";

      if (authSubmitBtn) authSubmitBtn.textContent = mode === "register" ? "Зарегистрироваться" : "Войти";
      if (authSwitchText) authSwitchText.textContent = mode === "register" ? "Есть аккаунт?" : "Нет аккаунта?";
      if (authSwitchBtn) authSwitchBtn.textContent = mode === "register" ? "Войти" : "Зарегистрироваться";
    }

    function renderGate() {
      const access = isAuthed();
      if (homeHeader) homeHeader.hidden = !access;
      if (authSection) authSection.hidden = access;
      if (homeApp) homeApp.hidden = !access;
      if (nav) nav.hidden = !access;
      if (badge) badge.hidden = !access;
      if (reset) reset.hidden = !access;
      renderHeader();
      return access;
    }

    async function hashPassword(pw) {
      const text = `nur|${String(pw)}`;
      const data = new TextEncoder().encode(text);
      try {
        if (globalThis.crypto?.subtle?.digest) {
          const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
          return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
      } catch {
        // ignore
      }
      // fallback (weak, but avoids plaintext in storage)
      return btoa(unescape(encodeURIComponent(text))).slice(0, 64);
    }

    function normalizePhone(s) {
      const d = normalizeDigits(s);
      // KZ/RU-like lengths; keep it simple
      if (d.length < 10) return "";
      return d;
    }

    const todaySection = byId("todaySection");
    const calendarSection = byId("calendarSection");

    const today = new Date();
    const todayKey = dateKey(today);

    let currentMonth = (() => {
      const saved = state.ui?.homeMonth;
      if (saved && /^\d{4}-\d{2}$/.test(saved)) {
        const [y, m] = saved.split("-").map(Number);
        return new Date(y, m - 1, 1);
      }
      return new Date(today.getFullYear(), today.getMonth(), 1);
    })();

    function renderStats() {
      if (greeting) {
        greeting.textContent = state.profile?.name ? `Сәлем, ${state.profile.name}!` : "Главный экран";
      }
      const access = isAuthed();
      if (todaySection) todaySection.hidden = !access;
      if (calendarSection) calendarSection.hidden = !access;
      const balance = getWalletBalance();
      const streak = calcStreak();
      if (balanceEl) balanceEl.textContent = String(balance);
      if (streakEl) streakEl.textContent = String(streak);
      renderHeader();
    }

    function renderToday() {
      if (!todayMeta || !todayTasks || !todayProgress || !todayBonus) return;

      if (!isAuthed()) {
        todayTasks.textContent = "";
        todayProgress.textContent = `0/${TASKS.length}`;
        todayBonus.textContent = "Сегодня: +0";
        return;
      }

      todayMeta.textContent = today.toLocaleDateString("ru-RU", { weekday: "long", year: "numeric", month: "long", day: "2-digit" });

      const log = getDayLog(todayKey);
      const tasks = log.tasks;
      const points = dayPointsFromTasks(tasks);
      const doneCount = TASKS.reduce((acc, t) => acc + (tasks?.[t.key] ? 1 : 0), 0);
      todayProgress.textContent = `${doneCount}/${TASKS.length}`;
      todayBonus.textContent = `Сегодня: +${points}`;

      todayTasks.textContent = "";

      for (const t of TASKS) {
        const row = document.createElement("div");
        row.className = "task";

        const left = document.createElement("div");
        left.className = "taskLeft";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "cb";
        cb.checked = Boolean(tasks?.[t.key]);
        cb.disabled = false;

        const text = document.createElement("div");
        const title = document.createElement("div");
        title.className = "taskTitle";
        title.textContent = t.title;
        const meta = document.createElement("div");
        meta.className = "taskMeta";
        meta.textContent = t.meta;
        text.appendChild(title);
        text.appendChild(meta);

        left.appendChild(cb);
        left.appendChild(text);

        const right = document.createElement("div");
        right.className = "taskRight";
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip chipBtn";
        chip.textContent = `+${t.points}`;
        if (cb.checked) chip.classList.add("chipHot");
        chip.title = "Нажмите, чтобы подсветить";
        chip.setAttribute("aria-label", `Бонус за задачу: +${t.points}`);
        right.appendChild(chip);

        row.appendChild(left);
        row.appendChild(right);

        const applyTaskToggle = () => {
          const l = getDayLog(todayKey);
          const prevPoints = Number.isFinite(l.awardedPoints) ? l.awardedPoints : dayPointsFromTasks(l.tasks);
          l.tasks[t.key] = cb.checked;
          const nextPoints = dayPointsFromTasks(l.tasks);
          applyWalletDelta(nextPoints - prevPoints);
          l.awardedPoints = nextPoints;
          l.updatedAt = new Date().toISOString();
          saveState();
          renderStats();
          renderToday();
          renderCalendar();

          // Visual feedback: highlight points of this task
          chip.classList.toggle("chipHot", cb.checked);
          chip.classList.remove("glow");
          void chip.offsetWidth;
          chip.classList.add("glow");
          window.setTimeout(() => chip.classList.remove("glow"), 650);
        };

        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          // Only glow when the task is completed
          if (!cb.checked) return;
          chip.classList.remove("burn");
          void chip.offsetWidth;
          chip.classList.add("burn");
          window.setTimeout(() => chip.classList.remove("burn"), 700);
        });

        cb.addEventListener("change", applyTaskToggle);

        // Make the whole row clickable (except direct checkbox clicks)
        row.addEventListener("click", (e) => {
          if (e.target === cb) return;
          if (e.target === chip) return;
          cb.checked = !cb.checked;
          applyTaskToggle();
        });

        todayTasks.appendChild(row);
      }
    }

    function renderCalendar() {
      if (!calMonth || !calGrid) return;

      if (!isAuthed()) {
        calGrid.textContent = "";
        calMonth.textContent = "";
        return;
      }
      state.ui = state.ui || {};
      state.ui.homeMonth = monthKey(currentMonth);
      saveState();

      calMonth.textContent = currentMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

      const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const last = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      const daysInMonth = last.getDate();

      // Monday-first offset
      const jsDay = first.getDay(); // 0 Sun..6 Sat
      const offset = (jsDay + 6) % 7;

      calGrid.textContent = "";

      for (let i = 0; i < offset; i++) {
        const empty = document.createElement("div");
        empty.className = "day dayMuted";
        empty.textContent = "";
        calGrid.appendChild(empty);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        const key = dateKey(d);
        const log = state.daily?.[key];
        const tasks = log?.tasks;
        const note = typeof log?.note === "string" ? log.note.trim() : "";
        const status = dayStatus(tasks);
        const points = dayPointsFromTasks(tasks);

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "day";
        if (status === "part") cell.classList.add("dayPart");
        if (status === "good") cell.classList.add("dayGood");
        if (status === "perfect") cell.classList.add("dayPerfect");
        if (key === todayKey) cell.classList.add("dayToday");
        cell.textContent = String(day);

        const statusText = status === "perfect" ? "всё выполнено" : status === "good" ? "2 чистки" : status === "part" ? "частично" : "нет отметок";
        const baseTitle = status !== "none" ? `+${points} • ${statusText}` : statusText;
        cell.title = note ? `${baseTitle} — Заметка: ${note}` : baseTitle;

        if (note) {
          const dot = document.createElement("span");
          dot.className = "dayNote";
          dot.setAttribute("aria-hidden", "true");
          cell.appendChild(dot);
        }

        cell.addEventListener("click", () => {
          if (!isAuthed()) return;
          const current = typeof state.daily?.[key]?.note === "string" ? state.daily[key].note : "";
          const next = window.prompt("Упоминание / заметка на этот день:", current);
          if (next === null) return;
          const value = String(next).trim();

          const dayLog = getDayLog(key);
          if (!value) {
            delete dayLog.note;
          } else {
            dayLog.note = value;
          }
          dayLog.updatedAt = new Date().toISOString();
          saveState();
          renderCalendar();
        });

        calGrid.appendChild(cell);
      }
    }

    on(todayResetBtn, "click", () => {
      if (!isAuthed()) return;
      const log = getDayLog(todayKey);
      const prevPoints = Number.isFinite(log.awardedPoints) ? log.awardedPoints : dayPointsFromTasks(log.tasks);
      log.tasks = {};
      const nextPoints = 0;
      applyWalletDelta(nextPoints - prevPoints);
      log.awardedPoints = nextPoints;
      log.updatedAt = new Date().toISOString();
      saveState();
      renderStats();
      renderToday();
      renderCalendar();
    });

    on(calPrev, "click", () => {
      if (!isAuthed()) return;
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    on(calNext, "click", () => {
      if (!isAuthed()) return;
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderCalendar();
    });

    on(authTabEmail, "click", () => {
      setAuthUi({ method: "email" });
      renderAuthUi();
      setAuthMsg("");
      authEmailInput?.focus?.();
    });
    on(authTabPhone, "click", () => {
      setAuthUi({ method: "phone" });
      renderAuthUi();
      setAuthMsg("");
      authPhoneInput?.focus?.();
    });

    on(authSwitchBtn, "click", () => {
      const { mode } = getAuthUi();
      setAuthUi({ mode: mode === "login" ? "register" : "login" });
      renderAuthUi();
      setAuthMsg("");
    });

    on(pwToggle, "click", () => {
      if (!authPasswordInput) return;
      const isPw = authPasswordInput.type === "password";
      authPasswordInput.type = isPw ? "text" : "password";
      pwToggle?.setAttribute("aria-label", isPw ? "Скрыть пароль" : "Показать пароль");
      pwToggle.title = isPw ? "Скрыть пароль" : "Показать пароль";
    });

    on(forgotBtn, "click", () => {
      setAuthMsg("В прототипе восстановление пароля недоступно.");
    });

    on(authForm, "submit", async (e) => {
      e.preventDefault();
      ensureAuth();
      const { method, mode } = getAuthUi();
      const id = method === "email" ? String(authEmailInput?.value || "").trim().toLowerCase() : normalizePhone(authPhoneInput?.value || "");
      const pw = String(authPasswordInput?.value || "");

      if (!id) {
        setAuthMsg(method === "email" ? "Введите email." : "Введите телефон.", "error");
        return;
      }
      if (method === "email" && !/^\S+@\S+\.[^\s@]+$/.test(id)) {
        setAuthMsg("Введите корректный email.", "error");
        return;
      }
      if (method === "phone" && id.length < 10) {
        setAuthMsg("Введите корректный телефон.", "error");
        return;
      }
      if (pw.length < 4) {
        setAuthMsg("Пароль слишком короткий.", "error");
        return;
      }

      const passHash = await hashPassword(pw);

      if (mode === "register") {
        const age = Number(normalizeDigits(authAgeInput?.value || ""));
        const iin = normalizeDigits(authIinInput?.value || "");
        if (!Number.isFinite(age) || age < 1 || age > 120) {
          setAuthMsg("Для регистрации укажите возраст.", "error");
          authAgeInput?.focus?.();
          return;
        }
        if (!isValidIin(iin)) {
          setAuthMsg("Для регистрации укажите корректный ИИН (12 цифр).", "error");
          authIinInput?.focus?.();
          return;
        }

        state.auth = { loggedIn: true, method, id, passHash };
        state.profile = { ...(state.profile || {}), iin, age };
        saveState();
        await playAuthSuccess("Успешная регистрация");

        // If redirected here from another page, go there; otherwise show home.
        try {
          const params = new URLSearchParams(location.search);
          const next = params.get("next");
          const allowed = new Set(["profile.html", "survey.html", "history.html", "index.html"]);
          if (next && allowed.has(next)) {
            location.replace(`./${next}`);
            return;
          }
        } catch {
          // ignore
        }

        renderGate();
        renderStats();
        renderToday();
        renderCalendar();
        return;
      }

      // login
      if (!state.auth?.id || !state.auth?.passHash) {
        setAuthMsg("Нет аккаунта. Нажмите ‘Зарегистрироваться’.", "error");
        return;
      }
      if (state.auth.method !== method || state.auth.id !== id || state.auth.passHash !== passHash) {
        setAuthMsg("Неверные данные для входа.", "error");
        return;
      }

      state.auth.loggedIn = true;
      saveState();
      await playAuthSuccess("Успешный вход");

      try {
        const params = new URLSearchParams(location.search);
        const next = params.get("next");
        const allowed = new Set(["profile.html", "survey.html", "history.html", "index.html"]);
        if (next && allowed.has(next)) {
          location.replace(`./${next}`);
          return;
        }
      } catch {
        // ignore
      }

      renderGate();
      renderStats();
      renderToday();
      renderCalendar();
    });

    renderAuthUi();

    const accessNow = renderGate();
    if (accessNow) {
      renderStats();
      renderToday();
      renderCalendar();
    }
  }

  function initProfilePage() {
    const profileView = byId("profileView");
    const profileForm = byId("profileForm");
    const profileName = byId("profileName");
    const profileIin = byId("profileIin");
    const profileAge = byId("profileAge");
    const nameInput = byId("nameInput");
    const ageInput = byId("ageInput");
    const iinInput = byId("iinInput");
    const editProfileBtn = byId("editProfileBtn");
    const clearProfileBtn = byId("clearProfileBtn");
    const cancelProfileBtn = byId("cancelProfileBtn");

    const renderProfile = () => {
      if (!profileView || !profileForm) return;
      if (state.profile?.iin) {
        profileView.hidden = false;
        profileForm.hidden = true;
        if (cancelProfileBtn) cancelProfileBtn.hidden = true;
        if (profileName) profileName.textContent = state.profile.name ? state.profile.name : "—";
        if (profileIin) profileIin.textContent = state.profile.iin;
        if (profileAge) profileAge.textContent = Number.isFinite(state.profile.age) ? String(state.profile.age) : "—";
      } else {
        profileView.hidden = true;
        profileForm.hidden = false;
      }
      renderHeader();
    };

    const beginEdit = () => {
      if (!profileView || !profileForm) return;
      profileView.hidden = true;
      profileForm.hidden = false;
      if (cancelProfileBtn) cancelProfileBtn.hidden = false;
      if (nameInput) nameInput.value = state.profile?.name ?? "";
      if (iinInput) iinInput.value = state.profile?.iin ?? "";
      if (ageInput) ageInput.value = Number.isFinite(state.profile?.age) ? String(state.profile.age) : "";
      nameInput?.focus?.();
    };

    on(profileForm, "submit", (e) => {
      e.preventDefault();

      const name = (nameInput?.value || "").trim();
      const iin = normalizeDigits(iinInput?.value || "");
      const age = Number(normalizeDigits(ageInput?.value || ""));

      if (!isValidIin(iin)) {
        iinInput?.focus?.();
        return;
      }
      if (!Number.isFinite(age) || age < 1 || age > 120) {
        ageInput?.focus?.();
        return;
      }

      state.profile = { iin, age, ...(name ? { name } : {}) };
      saveState();
      renderProfile();

      // Only redirect back if we came here via registration gating
      try {
        const params = new URLSearchParams(location.search);
        const next = params.get("next");
        const allowed = new Set(["index.html", "survey.html", "history.html"]);
        if (next && allowed.has(next)) {
          location.replace(`./${next}`);
        }
      } catch {
        // ignore
      }
    });

    on(editProfileBtn, "click", beginEdit);
    on(cancelProfileBtn, "click", () => {
      profileForm?.reset?.();
      renderProfile();
    });
    on(clearProfileBtn, "click", () => {
      state.profile = null;
      saveState();
      renderProfile();
    });

    renderProfile();
  }

  function initSurveyPage() {
    const surveyForm = byId("surveyForm");
    const clearFormBtn = byId("clearFormBtn");
    const walletBalanceEl = byId("walletBalance");
    const adviceCostEl = byId("adviceCost");

    const renderPayInfo = () => {
      if (walletBalanceEl) walletBalanceEl.textContent = String(getWalletBalance());
      if (adviceCostEl) adviceCostEl.textContent = String(ADVICE_COST);
      renderHeader();
    };

    on(clearFormBtn, "click", () => {
      surveyForm?.reset?.();
      const brushingInput = byId("brushingInput");
      const flossInput = byId("flossInput");
      const mouthwashInput = byId("mouthwashInput");
      const sugarInput = byId("sugarInput");
      const bleedingInput = byId("bleedingInput");
      const sensitivityInput = byId("sensitivityInput");
      const smokeInput = byId("smokeInput");
      const goalInput = byId("goalInput");
      if (brushingInput) brushingInput.value = "2";
      if (flossInput) flossInput.value = "sometimes";
      if (mouthwashInput) mouthwashInput.value = "no";
      if (sugarInput) sugarInput.value = "medium";
      if (bleedingInput) bleedingInput.value = "no";
      if (sensitivityInput) sensitivityInput.value = "none";
      if (smokeInput) smokeInput.value = "no";
      if (goalInput) goalInput.value = "prevent";
      setMsg("");
    });

    on(surveyForm, "submit", (e) => {
      e.preventDefault();

      if (!isAuthed()) return;

      if (getWalletBalance() < ADVICE_COST) {
        const need = ADVICE_COST - getWalletBalance();
        setMsg(`Недостаточно баллов. Нужно ещё: ${need}. Выполняйте задачи на главной, чтобы пополнить кошелёк.`);
        return;
      }

      const survey = getSurveyFromForm();

      // Spend points for advice
      applyWalletDelta(-ADVICE_COST);
      saveState();
      renderPayInfo();

      const advice = generateAdvice({ profile: state.profile, survey });
      const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()) + String(Math.random());

      const entry = {
        id,
        createdAt: new Date().toISOString(),
        profile: state.profile,
        question: survey.question,
        survey,
        advice,
        spent: { type: "advice", cost: ADVICE_COST },
      };

      state.history.push(entry);
      saveState();

      showAdvice(advice);
      setMsg(`Готово — рекомендации добавлены в историю. Списано: ${ADVICE_COST}.`);
      renderPayInfo();
    });

    // If opened from history
    const params = new URLSearchParams(location.search);
    const entryId = params.get("entry");
    if (entryId) {
      const found = state.history.find((x) => x.id === entryId);
      if (found) {
        applySurveyToForm(found.survey);
        showAdvice(found.advice);
        setMsg("Открыта запись из истории." );
      } else {
        setMsg("Запись из истории не найдена (возможно, была удалена)." );
      }
    }

    renderPayInfo();
  }

  function initHistoryPage() {
    on(byId("clearHistoryBtn"), "click", () => {
      state.history = [];
      saveState();
      renderHistory();
    });
    renderHistory();
  }

  // Init
  const blocked = initCommon();
  if (blocked) return;
  if (page === "home") initHomePage();
  if (page === "profile") initProfilePage();
  if (page === "survey") initSurveyPage();
  if (page === "history") initHistoryPage();
})();
