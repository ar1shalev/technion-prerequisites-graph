// App State
let coursesData = [];
let coursesMap = new Map(); // code -> course object
let faculties = [];
let activeFaculties = new Set();
let selectedCourseCode = null;
let currentSemester = null;
let viewMode = 'faculty'; // 'faculty' or 'local'
let examFilter = 'all'; // 'all', 'has_exam', 'no_exam'
let activeDays = new Set(); // Set of days
let courseSemestersMap = new Map(); // code -> Set of semesters
let showAllHistoricalCourses = false;
let showExternalCourses = false;
let showSportsCourses = false;
let useHierarchicalLayout = false;
let useCompression = false;
let baseNodeFontSize = 10;
let currentFilteredCourses = []; // courses that match criteria, excluding prereqs
let modalShowPrereqs = false; // whether modal list includes prerequisite courses
let savedView = null; // Stores position and scale before re-rendering

function saveCurrentView() {
  if (network) {
    savedView = {
      position: network.getViewPosition(),
      scale: network.getScale()
    };
  }
}

let historicalCoursesInfo = new Map(); // code -> course object, from the most recent semester that offered it
let historicalCourseSource = new Map(); // code -> { year, semester, label } that historicalCoursesInfo came from

// Branch Hiding State
let hiddenCourses = new Set();  // all explicitly hidden course codes
let hiddenBranches = [];         // [{root, rootName, codes: Set}]  — for individual restore
let hiddenNodePositions = {};    // code -> {x, y}  — for exact coordinate restoration


// Graph Adjacency Lists
let adjList = new Map(); // code -> Set of prerequisite codes (needs)
let revAdjList = new Map(); // code -> Set of dependent codes (unlocks)
let coReqList = new Map(); // code -> Set of co-requisite codes

// Vis.js Network instance
let network = null;
let networkNodes = null;
let networkEdges = null;

// Faculty Color Palette
const FACULTY_COLORS = {
  "הפקולטה למדעי המחשב": "#3b82f6", // Blue
  "הפקולטה להנדסת חשמל ומחשבים": "#06b6d4", // Cyan
  "הפקולטה למתמטיקה": "#8b5cf6", // Purple
  "הפקולטה לפיזיקה": "#d946ef", // Magenta
  "הפקולטה לכימיה": "#ec4899", // Pink
  "הפקולטה למדעי הנתונים וההחלטות": "#f97316", // Orange
  "הפקולטה להנדסת מכונות": "#eab308", // Yellow
  "הפקולטה להנדסה אזרחית וסביבתית": "#10b981", // Emerald
  "הפקולטה להנדסת אווירונוטיקה וחלל": "#14b8a6", // Teal
  "הפקולטה לרפואה": "#ef4444", // Red
  "הפקולטה להנדסה ביו-רפואית": "#f43f5e", // Rose
  "הפקולטה לביולוגיה": "#22c55e", // Green
  "הפקולטה לארכיטקטורה ובינוי ערים": "#84cc16", // Lime
  "המחלקה ללימודים הומניסטיים ואמנות": "#6b7280", // Gray
  "הפקולטה למדע והנדסה של חומרים": "#a855f7", // Violet
  "הפקולטה להנדסת ביוטכנולוגיה ומזון": "#65a30d", // Dark Green
  "חינוך למדע וטכנולוגיה": "#fb7185", // Light Pink
  "הפקולטה להנדסה כימית": "#4f46e5", // Indigo
};

const DEFAULT_COLOR = "#9ca3af";

// Two different kinds of "not offered this semester", which used to look identical:
// a course that runs in other semesters, and a course number that only ever shows up
// inside somebody's prerequisite list.
const OTHER_SEMESTER_STYLE = {
  border: "#f59e0b", // Amber
  background: "rgba(245, 158, 11, 0.10)",
  highlightBackground: "rgba(245, 158, 11, 0.22)",
  dashes: [6, 3],
  fontLight: "#b45309",
  fontDark: "#fcd34d"
};

const EXTERNAL_STYLE = {
  border: "#ef4444", // Red
  background: "rgba(239, 68, 68, 0.08)",
  highlightBackground: "rgba(239, 68, 68, 0.2)",
  dashes: [3, 3],
  fontLight: "#b91c1c",
  fontDark: "#fca5a5"
};

function getFacultyColor(facultyName) {
  return FACULTY_COLORS[facultyName] || DEFAULT_COLOR;
}

// Apply one of the two "not offered" looks to a node, so the three call sites can't drift apart
function applyUnofferedNodeStyle(nodeObj, style, isLightTheme) {
  nodeObj.color = {
    background: style.background,
    border: style.border,
    highlight: { background: style.highlightBackground, border: style.border }
  };
  nodeObj.borderWidth = 1.5;
  nodeObj.shapeProperties = { borderDashes: style.dashes };
  nodeObj.font = {
    color: isLightTheme ? style.fontLight : style.fontDark,
    size: baseNodeFontSize - 0.5
  };
  return nodeObj;
}

// Course-responsible staff. Populated for roughly half the courses, and it changes
// between semesters, so callers say which semester the value came from.
function getResponsible(course) {
  const raw = course && course.general && course.general["אחראים"];
  if (!raw) return [];
  const names = raw.split("\n").map(n => n.trim()).filter(n => n.length > 0);
  return Array.from(new Set(names));
}

function courseDisplayName(code) {
  const course = coursesMap.get(code) || historicalCoursesInfo.get(code);
  return course ? course.general["שם מקצוע"] : code;
}

// One tooltip builder for all four node kinds, so the three places that build nodes
// can't drift apart. Vis.js renders this as plain text, newline separated.
// kind: 'offered' | 'supporting' | 'other-semester' | 'external'
function buildNodeTooltip(code, kind) {
  const lines = [];
  const course = (kind === 'other-semester')
    ? historicalCoursesInfo.get(code)
    : coursesMap.get(code);

  if (!course) {
    lines.push(code);
    lines.push("קורס חיצוני — לא נמצא באף סמסטר בנתונים");
    const requiredBy = Array.from(revAdjList.get(code) || []);
    if (requiredBy.length > 0) {
      const shown = requiredBy.slice(0, 4).map(courseDisplayName);
      const rest = requiredBy.length - shown.length;
      lines.push(`נדרש עבור: ${shown.join(", ")}${rest > 0 ? ` ועוד ${rest}` : ""}`);
    }
    return lines.join("\n");
  }

  const gen = course.general;
  lines.push(`${code} - ${gen["שם מקצוע"]}`);

  let facultyLine = gen["פקולטה"];
  if (kind === 'supporting') facultyLine += " (דרישת קדם תומכת)";
  else if (kind === 'other-semester') facultyLine += " (לא מוצע הסמסטר)";
  lines.push(facultyLine);

  lines.push(`נקודות: ${gen["נקודות"]}`);

  const responsible = getResponsible(course);
  if (responsible.length > 0) {
    lines.push(`אחראים: ${responsible.join(", ")}`);
  }

  if (kind === 'other-semester') {
    const source = historicalCourseSource.get(code);
    if (source) {
      lines.push(`המידע מסמסטר ${source.label} — ייתכן שישתנה`);
    }
    const offered = courseSemestersMap.get(code);
    if (offered && offered.size > 0) {
      lines.push(`נלמד ב: ${Array.from(offered).join(", ")}`);
    }
  } else if (gen["מועד א"]) {
    lines.push(`מועד א: ${gen["מועד א"].split("\n")[0]}`);
  }

  return lines.join("\n");
}

// Initialization on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initSemesterSelect();
  setupEventListeners();
  loadAllSemestersIndex(); // Load the semesters mapping in background
});

// One label format for "which semester", so the dropdown, the offerings map and the
// details panel can't disagree. Winter straddles two calendar years; spring and summer
// fall entirely in the second one.
function semesterLabel(year, semester) {
  const y = parseInt(year, 10);
  const s = parseInt(semester, 10);
  if (s === 200) return `חורף ${y}/${y + 1}`;
  if (s === 201) return `אביב ${y + 1}`;
  if (s === 202) return `קיץ ${y + 1}`;
  return `${y}-${s}`;
}

// Load all semesters in the background to build the offerings map
async function loadAllSemestersIndex() {
  try {
    const response = await fetch("data/last_semesters.json");
    if (!response.ok) return;
    const semesters = await response.json();

    courseSemestersMap.clear();
    historicalCoursesInfo.clear();
    historicalCourseSource.clear();

    // Load all in background
    const promises = semesters.map(async (sem) => {
      const key = `${sem.year}-${sem.semester}`;
      const label = semesterLabel(sem.year, sem.semester);

      try {
        const res = await fetch(`data/courses_${sem.year}_${sem.semester}.json`);
        if (res.ok) {
          const data = await res.json();
          data.forEach(course => {
            const code = course.general && course.general["מספר מקצוע"];
            if (code) {
              if (!courseSemestersMap.has(code)) {
                courseSemestersMap.set(code, new Set());
              }
              courseSemestersMap.get(code).add(label);

              // Keep the most recent semester's copy. Staff, schedule and exam dates all
              // change between semesters, so it matters which one we cached — these
              // fetches finish in arbitrary order, so compare instead of taking the first.
              const cached = historicalCourseSource.get(code);
              const isNewer = !cached
                || sem.year > cached.year
                || (sem.year === cached.year && sem.semester > cached.semester);
              if (isNewer) {
                historicalCoursesInfo.set(code, course);
                historicalCourseSource.set(code, { year: sem.year, semester: sem.semester, label });
              }
            }
          });
        }
      } catch (e) {
        console.error(`Failed to load historical data for ${key}`, e);
      }
    });

    await Promise.all(promises);
    
    // Rebuild graph now that we have all historical courses, to include their prerequisites in the adjacency lists
    buildGraph();
    renderGraph();
    
    // If a course is currently selected, refresh details to display its semesters and new unlocks
    if (selectedCourseCode) {
      updateDetailsPanel();
    }
  } catch (error) {
    console.error("Failed to build semester index:", error);
  }
}

// Load Semester Metadata
async function initSemesterSelect() {
  showLoading("טוען רשימת סמסטרים...");
  try {
    const response = await fetch("data/last_semesters.json");
    if (!response.ok) throw new Error("Failed to load semesters metadata");
    const semesters = await response.json();

    const select = document.getElementById("semester-select");
    select.innerHTML = "";

    semesters.forEach(sem => {
      const option = document.createElement("option");
      option.value = `${sem.year}-${sem.semester}`;

      let semName = "";
      if (sem.semester === 200) semName = "חורף";
      else if (sem.semester === 201) semName = "אביב";
      else if (sem.semester === 202) semName = "קיץ";

      // Only winter straddles two calendar years and gets (YY/YY+1)
      if (sem.semester === 200) {
        option.textContent = `סמסטר ${semName} ${sem.year} (${sem.year % 100}/${(sem.year + 1) % 100})`;
      } else {
        option.textContent = `סמסטר ${semName} ${sem.year + 1}`;
      }
      select.appendChild(option);
    });

    if (semesters.length > 0) {
      currentSemester = `${semesters[0].year}-${semesters[0].semester}`;
      loadSemesterData(currentSemester);
    }
  } catch (error) {
    console.error(error);
    showLoading("שגיאה בטעינת הנתונים. אנא ודא שהקובץ קיים ונסה שוב.");
  }
}

// Load Course Data for specific semester
async function loadSemesterData(semesterVal) {
  showLoading("טוען נתוני קורסים... (זה עשוי לקחת מספר שניות)");

  const [year, semester] = semesterVal.split("-");
  const dataPath = `data/courses_${year}_${semester}.json`;

  try {
    const response = await fetch(dataPath);
    if (!response.ok) throw new Error(`Failed to load course data from ${dataPath}`);

    coursesData = await response.json();
    processCoursesData();
    buildGraph();
    populateFacultiesPanel();

    // Clear hidden branches state
    hiddenCourses.clear();
    hiddenBranches = [];
    hiddenNodePositions = {};
    updateHiddenBranchesPanel();

    // Preserve selection, but update details for the new semester
    if (selectedCourseCode) {
      document.getElementById("course-search").value = coursesMap.has(selectedCourseCode) ? coursesMap.get(selectedCourseCode).general["שם מקצוע"] : (historicalCoursesInfo.get(selectedCourseCode)?.general["שם מקצוע"] || selectedCourseCode);
      document.getElementById("clear-search-btn").style.display = "block";
    }

    updateDetailsPanel();

    // Reset view
    renderGraph();
    hideLoading();
  } catch (error) {
    console.error(error);
    showLoading(`שגיאה בטעינת קורסים עבור ${semesterVal}.`);
  }
}

// Process data and build course lookup map
function processCoursesData() {
  coursesMap.clear();
  const uniqueFaculties = new Set();

  coursesData.forEach(course => {
    const gen = course.general;
    if (gen && gen["מספר מקצוע"]) {
      const code = gen["מספר מקצוע"];
      coursesMap.set(code, course);

      if (gen["פקולטה"]) {
        uniqueFaculties.add(gen["פקולטה"].trim());
      }
    }
  });

  faculties = Array.from(uniqueFaculties).sort((a, b) => {
    const first = "המחלקה ללימודים הומניסטיים ואמנות";
    const second = "הפקולטה להנדסת מכונות";

    if (a === first) return -1;
    if (b === first) return 1;
    if (a === second) return -1;
    if (b === second) return 1;

    return a.localeCompare(b, 'he');
  });

  // Set default active faculty to Mechanical Engineering
  activeFaculties.clear();
  const defaultFac = "הפקולטה להנדסת מכונות";
  if (faculties.includes(defaultFac)) {
    activeFaculties.add(defaultFac);
  } else if (faculties.length > 0) {
    activeFaculties.add(faculties[0]);
  }
}

// Extract course codes from prerequisite string.
// The graph deliberately keeps using this flat list: an edge from every mentioned
// course is the conservative choice for a visualisation. Only the sidebar cares
// about the and/or structure, and that goes through parsePrereqTree below.
function parsePrerequisites(prereqStr) {
  if (!prereqStr) return [];
  // Matches 8-digit numbers representing course codes
  const matches = prereqStr.match(/\b\d{8}\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

// Split a prerequisite string into its tokens.
// Note the asymmetry in the source data: "או" is surrounded by spaces, while "ו-"
// runs straight into the course number after it ("00140143 ו-00140149").
function tokenizePrereqs(prereqStr) {
  const tokens = [];
  let i = 0;

  while (i < prereqStr.length) {
    const rest = prereqStr.slice(i);

    const space = rest.match(/^\s+/);
    if (space) {
      i += space[0].length;
      continue;
    }

    if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ type: rest[0] });
      i += 1;
      continue;
    }

    const code = rest.match(/^\d{8}/);
    if (code) {
      tokens.push({ type: "code", value: code[0] });
      i += code[0].length;
      continue;
    }

    if (rest.startsWith("ו-")) {
      tokens.push({ type: "and" });
      i += 2;
      continue;
    }

    if (rest.startsWith("או")) {
      tokens.push({ type: "or" });
      i += 2;
      continue;
    }

    return null; // Something we don't recognise - the caller falls back to a flat list
  }

  return tokens;
}

// Parse a prerequisite string into an and/or tree, cheesefork style, so alternative
// groups can be shown apart from each other instead of as one undifferentiated list.
// Returns {op:'and'|'or', children:[...]} or {code:'...'}, or null if the string
// doesn't parse - callers must handle null, since this field is free-form SAP output.
function parsePrereqTree(prereqStr) {
  if (!prereqStr) return null;

  const tokens = tokenizePrereqs(prereqStr);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;

  // Same-op children get flattened, and a group of one is just that one thing
  function group(op, children) {
    const flat = [];
    children.forEach(child => {
      if (child.op === op) flat.push(...child.children);
      else flat.push(child);
    });
    return flat.length === 1 ? flat[0] : { op, children: flat };
  }

  // "and" binds tighter than "or", so "A ו-B או C" reads as "(A and B) or C"
  function parseExpr() {
    const children = [parseTerm()];
    if (children[0] === null) return null;

    while (pos < tokens.length && tokens[pos].type === "or") {
      pos += 1;
      const next = parseTerm();
      if (next === null) return null;
      children.push(next);
    }

    return group("or", children);
  }

  function parseTerm() {
    const children = [parseFactor()];
    if (children[0] === null) return null;

    while (pos < tokens.length && tokens[pos].type === "and") {
      pos += 1;
      const next = parseFactor();
      if (next === null) return null;
      children.push(next);
    }

    return group("and", children);
  }

  function parseFactor() {
    const token = tokens[pos];
    if (!token) return null;

    if (token.type === "code") {
      pos += 1;
      return { code: token.value };
    }

    if (token.type === "(") {
      pos += 1;
      const inner = parseExpr();
      if (inner === null) return null;
      if (!tokens[pos] || tokens[pos].type !== ")") return null;
      pos += 1;
      return inner;
    }

    return null;
  }

  const tree = parseExpr();
  if (tree === null || pos !== tokens.length) return null;
  return tree;
}

// Build adjacency lists for graph traversal
function buildGraph() {
  adjList.clear();
  revAdjList.clear();
  coReqList.clear();

  // Initialize lists for all known courses across all semesters
  const allKnownCourses = new Map([...historicalCoursesInfo.entries(), ...coursesMap.entries()]);

  for (const code of allKnownCourses.keys()) {
    adjList.set(code, new Set());
    revAdjList.set(code, new Set());
    coReqList.set(code, new Set());
  }

  // Populate lists
  for (const [code, course] of allKnownCourses.entries()) {
    const gen = course.general;

  // Prerequisites
  const prereqStr = gen["מקצועות קדם"];
  const prereqs = parsePrerequisites(prereqStr);

  prereqs.forEach(pre => {
    // Ensure the prerequisite node is represented, even if external
    if (!adjList.has(pre)) adjList.set(pre, new Set());
    if (!revAdjList.has(pre)) revAdjList.set(pre, new Set());

    adjList.get(code).add(pre);
    revAdjList.get(pre).add(code);
  });

  // Co-requisites (מקצועות צמודים)
  const coReqStr = gen["מקצועות צמודים"];
  if (coReqStr) {
    const coReqs = coReqStr.split(/\s+/).filter(c => c.length > 0);
    coReqs.forEach(co => {
      if (!coReqList.has(code)) coReqList.set(code, new Set());
      if (!coReqList.has(co)) coReqList.set(co, new Set());
      coReqList.get(code).add(co);
    });
  }
}
}

// Transitive Closure: Get all recursive prerequisites (ancestors)
function getRecursivePrereqs(code, visited = new Set()) {
  if (visited.has(code)) return visited;
  visited.add(code);

  const direct = adjList.get(code);
  if (direct) {
    direct.forEach(pre => {
      getRecursivePrereqs(pre, visited);
    });
  }

  return visited;
}

// Transitive Closure: Get all recursive unlocks (descendants)
function getRecursiveUnlocks(code, visited = new Set()) {
  if (visited.has(code)) return visited;
  visited.add(code);

  const direct = revAdjList.get(code);
  if (direct) {
    direct.forEach(child => {
      getRecursiveUnlocks(child, visited);
    });
  }

  return visited;
}

// UI Populators
function populateFacultiesPanel() {
  const container = document.getElementById("faculties-list");
  container.innerHTML = "";

  faculties.forEach(fac => {
    const tag = document.createElement("div");
    tag.className = `faculty-tag ${activeFaculties.has(fac) ? 'active' : ''}`;
    tag.dataset.faculty = fac;

    const dot = document.createElement("span");
    dot.className = "faculty-color-dot";
    dot.style.backgroundColor = getFacultyColor(fac);

    const label = document.createElement("span");
    label.textContent = fac.replace("הפקולטה ל", "").replace("המחלקה ל", "");

    tag.appendChild(dot);
    tag.appendChild(label);

    tag.addEventListener("click", () => {
      if (activeFaculties.has(fac)) {
        activeFaculties.delete(fac);
      } else {
        activeFaculties.add(fac);
      }
      tag.classList.toggle("active");

      saveCurrentView();
      renderGraph();
    });

    container.appendChild(tag);
  });

  // Populate Legend
  updateLegend();
}

// Add one swatch + caption row to the legend
function addLegendSwatch(container, { background, border, dashed, text }) {
  const item = document.createElement("div");
  item.className = "legend-item";

  const swatch = document.createElement("span");
  swatch.className = "legend-color";
  swatch.style.backgroundColor = background;
  swatch.style.border = `1.5px ${dashed ? "dashed" : "solid"} ${border}`;
  swatch.style.borderRadius = "4px";

  const label = document.createElement("span");
  label.className = "legend-label";
  label.textContent = text;

  item.appendChild(swatch);
  item.appendChild(label);
  container.appendChild(item);
}

function updateLegend() {
  const container = document.getElementById("legend-items");
  container.innerHTML = "";

  // 1. Course status section
  const statusHeader = document.createElement("div");
  statusHeader.className = "legend-title";
  statusHeader.style.borderBottom = "none";
  statusHeader.style.paddingBottom = "0";
  statusHeader.style.marginTop = "0";
  statusHeader.textContent = "סטטוס הקורסים בסמסטר זה:";
  container.appendChild(statusHeader);

  addLegendSwatch(container, {
    background: "rgba(255, 255, 255, 0.08)",
    border: "#8b5cf6",
    dashed: false,
    text: "קורס מוצע בסמסטר הנוכחי (גבול מוצק בצבע הפקולטה)"
  });

  addLegendSwatch(container, {
    background: "rgba(10, 10, 15, 0.95)",
    border: "#8b5cf6",
    dashed: true,
    text: "דרישת קדם מפקולטה אחרת (גבול מקווקו בצבע הפקולטה)"
  });

  addLegendSwatch(container, {
    background: OTHER_SEMESTER_STYLE.background,
    border: OTHER_SEMESTER_STYLE.border,
    dashed: true,
    text: "מוצע בסמסטר אחר, לא בנוכחי (גבול כתום)"
  });

  addLegendSwatch(container, {
    background: EXTERNAL_STYLE.background,
    border: EXTERNAL_STYLE.border,
    dashed: true,
    text: "קורס חיצוני - לא נמצא באף סמסטר בנתונים (גבול אדום)"
  });

  // 2. Faculty colors section
  const colorHeader = document.createElement("div");
  colorHeader.className = "legend-title";
  colorHeader.style.borderBottom = "none";
  colorHeader.style.paddingBottom = "0";
  colorHeader.style.marginTop = "14px";
  colorHeader.textContent = "מקרא צבעים לפי פקולטה:";
  container.appendChild(colorHeader);

  // Show only active faculties (applies consistently across all views now)
  const list = Array.from(activeFaculties);

  if (list.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "legend-item";
    emptyMsg.innerHTML = "<span style='color: var(--text-muted); font-style: italic;'>אין פקולטות מוצגות</span>";
    container.appendChild(emptyMsg);
  } else {
    list.forEach(fac => {
      const item = document.createElement("div");
      item.className = "legend-item";

      const color = document.createElement("span");
      color.className = "legend-color";
      color.style.backgroundColor = getFacultyColor(fac);

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = fac.replace("הפקולטה ל", "").replace("המחלקה ל", "");
      label.title = fac;

      item.appendChild(color);
      item.appendChild(label);
      container.appendChild(item);
    });
  }

  // 3. Arrow types section
  const arrowHeader = document.createElement("div");
  arrowHeader.className = "legend-title";
  arrowHeader.style.borderBottom = "none";
  arrowHeader.style.paddingBottom = "0";
  arrowHeader.style.marginTop = "14px";
  arrowHeader.textContent = "קשרים וחיצים:";
  container.appendChild(arrowHeader);

  // Prerequisite arrow
  const prereqArrowItem = document.createElement("div");
  prereqArrowItem.className = "legend-item";
  const prereqArrowLine = document.createElement("span");
  prereqArrowLine.className = "legend-color";
  prereqArrowLine.style.height = "3px";
  prereqArrowLine.style.backgroundColor = "#8b5cf6";
  prereqArrowLine.style.border = "none";
  prereqArrowLine.style.borderRadius = "0";
  const prereqArrowLabel = document.createElement("span");
  prereqArrowLabel.className = "legend-label";
  prereqArrowLabel.textContent = "חץ כיווני (סגול): דרישת קדם";
  prereqArrowItem.appendChild(prereqArrowLine);
  prereqArrowItem.appendChild(prereqArrowLabel);
  container.appendChild(prereqArrowItem);

  // Co-requisite arrow
  const coreqArrowItem = document.createElement("div");
  coreqArrowItem.className = "legend-item";
  const coreqArrowLine = document.createElement("span");
  coreqArrowLine.className = "legend-color";
  coreqArrowLine.style.height = "3px";
  coreqArrowLine.style.background = "repeating-linear-gradient(90deg, #3b82f6, #3b82f6 4px, transparent 4px, transparent 8px)";
  coreqArrowLine.style.border = "none";
  coreqArrowLine.style.borderRadius = "0";
  const coreqArrowLabel = document.createElement("span");
  coreqArrowLabel.className = "legend-label";
  coreqArrowLabel.textContent = "חץ דו-צדדי מקווקו (תכלת): מקצועות צמודים";
  coreqArrowItem.appendChild(coreqArrowLine);
  coreqArrowItem.appendChild(coreqArrowLabel);
  container.appendChild(coreqArrowItem);
}

// Helper to convert hex to rgba with opacity
function hexToRgba(hex, opacity) {
  let c;
  if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    c = hex.substring(1).split('');
    if (c.length == 3) {
      c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    }
    c = '0x' + c.join('');
    return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + opacity + ')';
  }
  return hex;
}

// Helper to wrap text for node labels
function wrapText(text, maxLineLength = 15) {
  if (!text) return "";
  const words = text.split(/\s+/);
  let lines = [];
  let currentLine = "";

  words.forEach(word => {
    if ((currentLine + " " + word).trim().length > maxLineLength) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  });
  if (currentLine) lines.push(currentLine.trim());
  return lines.join("\n");
}

// Check if a course is a sports course
function isSportsCourse(course) {
  const gen = course.general;
  if (!gen) return false;
  const name = gen["שם מקצוע"] || "";
  const code = gen["מספר מקצוע"] || "";
  return (
    name.includes("חינוך גופני") ||
    name.includes("ספורט") ||
    name.includes("נבחרות ספורט") ||
    name.includes("נבחרת ספורט") ||
    code.startsWith("039408") ||
    code.startsWith("039409")
  );
}

// Filter validation helper
function courseMatchesFilters(course) {
  const gen = course.general;
  if (!gen) return false;

  // 0. Explicitly hidden branches
  if (hiddenCourses.has(gen["מספר מקצוע"])) return false;

  // 1. Sports courses filter (hidden by default unless checked)
  if (!showSportsCourses && isSportsCourse(course)) return false;

  // 2. Faculty filter (always applied - the faculty panel controls what's visible in all views)
  const fac = gen["פקולטה"];
  if (!fac || !activeFaculties.has(fac.trim())) return false;

  // 3. Exam filter (Historical courses don't have this semester's exam data)
  if (!course.isHistorical) {
    const hasExam = (gen["מועד א"] || gen["מועד ב"]);
    if (examFilter === 'has_exam' && !hasExam) return false;
    if (examFilter === 'no_exam' && hasExam) return false;
  }

  // 4. Days filter (Historical courses don't have this semester's schedule)
  if (!course.isHistorical && activeDays.size > 0) {
    const schedule = course.schedule || [];
    const courseDays = new Set(schedule.map(item => item["יום"]));

    // Check intersection
    let hasMatchingDay = false;
    for (const day of activeDays) {
      if (courseDays.has(day)) {
        hasMatchingDay = true;
        break;
      }
    }
    if (!hasMatchingDay) return false;
  }

  return true;
}

// Compute currentFilteredCourses based on the active filters
function refreshCurrentFilteredCourses() {
  currentFilteredCourses = [];
  for (const [code, course] of coursesMap.entries()) {
    if (courseMatchesFilters(course)) {
      currentFilteredCourses.push(course);
    }
  }

  if (showAllHistoricalCourses) {
    for (const [code, hist] of historicalCoursesInfo.entries()) {
      if (!coursesMap.has(code)) {
        const histCourse = JSON.parse(JSON.stringify(hist)); // Deep copy to avoid mutating cache
        histCourse.isHistorical = true;
        if (courseMatchesFilters(histCourse)) {
          currentFilteredCourses.push(histCourse);
        }
      }
    }
  }
}

// Generate the graph nodes and edges based on current filters and viewMode
function generateGraphData() {
  const isLightTheme = document.body.classList.contains("light-theme");
  const nodes = [];
  const edges = [];
  const addedNodes = new Set();
  const addedEdges = new Set();

  refreshCurrentFilteredCourses();

  if (viewMode === 'local' && selectedCourseCode) {
    // Isolated local view: selected course, ancestors (prereqs), descendants (unlocks)
    const recursivePrereqs = Array.from(getRecursivePrereqs(selectedCourseCode));
    const recursiveUnlocks = Array.from(getRecursiveUnlocks(selectedCourseCode));

    const allRelevantNodes = new Set([...recursivePrereqs, ...recursiveUnlocks, selectedCourseCode]);

    // Apply the active filters to the local tree nodes (excluding the selected course itself, which is always shown)
    const filteredRelevantNodes = new Set();
    allRelevantNodes.forEach(code => {
      if (code === selectedCourseCode) {
        filteredRelevantNodes.add(code);
        return;
      }
      if (hiddenCourses.has(code)) return; // Still honor manual hiding

      const course = coursesMap.get(code) || historicalCoursesInfo.get(code);
      const isPureExternal = !course;
      const isHist = course && !coursesMap.has(code);

      if (isPureExternal && !showExternalCourses) return;
      if (isHist && !showAllHistoricalCourses) return;

      if (isPureExternal) {
        filteredRelevantNodes.add(code);
        return;
      }

      const tempCourse = isHist ? { general: course.general, isHistorical: true } : course;
      
      if (courseMatchesFilters(tempCourse)) {
        filteredRelevantNodes.add(code);
      }
    });

    // Assign explicit levels for hierarchical layout:
    // prereqs get negative levels (above), selected = 0, unlocks get positive (below)
    const prereqSet = new Set(recursivePrereqs);
    const unlockSet = new Set(recursiveUnlocks);
    prereqSet.delete(selectedCourseCode);
    unlockSet.delete(selectedCourseCode);

    // BFS from selected course upward (prereqs) and downward (unlocks) to assign levels
    const levelMap = new Map();
    levelMap.set(selectedCourseCode, 0);

    // BFS upward through prereqs
    let queue = [selectedCourseCode];
    while (queue.length > 0) {
      const next = [];
      for (const node of queue) {
        const pres = adjList.get(node);
        if (pres) {
          pres.forEach(pre => {
            if (filteredRelevantNodes.has(pre) && !levelMap.has(pre)) {
              levelMap.set(pre, levelMap.get(node) - 1);
              next.push(pre);
            }
          });
        }
      }
      queue = next;
    }

    // BFS downward through unlocks
    queue = [selectedCourseCode];
    while (queue.length > 0) {
      const next = [];
      for (const node of queue) {
        const children = revAdjList.get(node);
        if (children) {
          children.forEach(child => {
            if (filteredRelevantNodes.has(child) && !levelMap.has(child)) {
              levelMap.set(child, levelMap.get(node) + 1);
              next.push(child);
            }
          });
        }
      }
      queue = next;
    }

    // Add nodes
    filteredRelevantNodes.forEach(code => {
      const course = coursesMap.get(code);
      const isSelected = code === selectedCourseCode;

      let labelText = code;
      if (course) {
        labelText = wrapText(course.general["שם מקצוע"], 15);
      } else {
        const hist = historicalCoursesInfo.get(code);
        if (hist) labelText = wrapText(hist.general["שם מקצוע"], 15);
      }

      let nodeObj = {
        id: code,
        label: labelText,
        level: levelMap.get(code) || 0,
        font: { size: isSelected ? (baseNodeFontSize + 2) : baseNodeFontSize, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' }
      };

      if (course) {
        const fac = course.general["פקולטה"];
        nodeObj.title = buildNodeTooltip(code, 'offered');

        if (isSelected) {
          nodeObj.color = {
            background: hexToRgba(getFacultyColor(fac), 0.8),
            border: isLightTheme ? '#111827' : '#ffffff',
            highlight: { background: hexToRgba(getFacultyColor(fac), 0.9), border: isLightTheme ? '#111827' : '#ffffff' }
          };
          nodeObj.borderWidth = 3;
          nodeObj.shadow = { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 };
        } else {
          nodeObj.color = {
            background: hexToRgba(getFacultyColor(fac), isLightTheme ? 0.15 : 0.25),
            border: getFacultyColor(fac),
            highlight: { background: hexToRgba(getFacultyColor(fac), 0.45), border: isLightTheme ? '#111827' : '#ffffff' }
          };
          nodeObj.borderWidth = 2; // Thicker solid border for offered course
        }
      } else if (historicalCoursesInfo.has(code)) {
        // Runs in other semesters, just not this one - amber
        nodeObj.title = buildNodeTooltip(code, 'other-semester');
        applyUnofferedNodeStyle(nodeObj, OTHER_SEMESTER_STYLE, isLightTheme);
      } else {
        // Only ever seen inside a prerequisite list - red
        nodeObj.title = buildNodeTooltip(code, 'external');
        applyUnofferedNodeStyle(nodeObj, EXTERNAL_STYLE, isLightTheme);
      }

      nodes.push(nodeObj);
      addedNodes.add(code);
    });

    // Add edges between these nodes
    filteredRelevantNodes.forEach(code => {
      const prereqs = adjList.get(code);
      if (prereqs) {
        prereqs.forEach(pre => {
          if (filteredRelevantNodes.has(pre)) {
            const edgeId = `${pre}->${code}`;
            if (!addedEdges.has(edgeId)) {
              // Check if it's on a direct path to/from selected node
              const isDirectPath = (pre === selectedCourseCode || code === selectedCourseCode);
              edges.push({
                id: edgeId,
                from: pre,
                to: code,
                color: isDirectPath ? '#8b5cf6' : (isLightTheme ? 'rgba(124, 58, 237, 0.35)' : 'rgba(139, 92, 246, 0.35)'),
                width: isDirectPath ? 2.5 : 1.2,
                arrows: { to: { enabled: true, scaleFactor: 0.8 } }
              });
              addedEdges.add(edgeId);
            }
          }
        });
      }

      // Add co-requisites as dashed purple/blue double-directed/undirected edges
      const coReqs = coReqList.get(code);
      if (coReqs) {
        coReqs.forEach(co => {
          if (filteredRelevantNodes.has(co)) {
            const edgeId1 = `${code}<->${co}`;
            const edgeId2 = `${co}<->${code}`;
            if (!addedEdges.has(edgeId1) && !addedEdges.has(edgeId2)) {
              const isSelectedPath = (code === selectedCourseCode || co === selectedCourseCode);
              edges.push({
                id: edgeId1,
                from: code,
                to: co,
                color: isSelectedPath ? '#3b82f6' : (isLightTheme ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.25)'),
                width: isSelectedPath ? 1.5 : 0.8,
                dashes: true,
                arrows: { to: { enabled: true, scaleFactor: 0.5 }, from: { enabled: true, scaleFactor: 0.5 } }
              });
              addedEdges.add(edgeId1);
            }
          }
        });
      }
    });

  } else {
    // Apply advanced filters and faculty constraints
    let coreCourses = currentFilteredCourses.map(c => c.general["מספר מקצוע"]);

    // Add all core courses to the node list
    coreCourses.forEach(code => {
      const course = coursesMap.get(code);
      const isSelected = code === selectedCourseCode;

      if (course) {
        const fac = course.general["פקולטה"];
        const name = course.general["שם מקצוע"];

        const nodeObj = {
          id: code,
          label: wrapText(name, 15),
          title: buildNodeTooltip(code, 'offered'),
          color: {
            background: isSelected ? hexToRgba(getFacultyColor(fac), 0.8) : hexToRgba(getFacultyColor(fac), isLightTheme ? 0.15 : 0.25),
            border: isSelected ? (isLightTheme ? '#111827' : '#ffffff') : getFacultyColor(fac),
            highlight: {
              background: isSelected ? hexToRgba(getFacultyColor(fac), 0.9) : hexToRgba(getFacultyColor(fac), 0.45),
              border: isLightTheme ? '#111827' : '#ffffff'
            }
          },
          borderWidth: isSelected ? 3 : 2, // Thicker solid border for offered course
          font: { size: isSelected ? (baseNodeFontSize + 2) : baseNodeFontSize, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' },
          shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
        };

        nodes.push(nodeObj);
        addedNodes.add(code);
      } else {
        // Runs in other semesters, just not this one
        const hist = historicalCoursesInfo.get(code);
        if (hist) {
          const nodeObj = {
            id: code,
            label: wrapText(hist.general["שם מקצוע"], 15),
            title: buildNodeTooltip(code, 'other-semester'),
            shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
          };
          applyUnofferedNodeStyle(nodeObj, OTHER_SEMESTER_STYLE, isLightTheme);
          nodes.push(nodeObj);
          addedNodes.add(code);
        }
      }
    });


    // Expand graph to include direct requisites from other faculties
    coreCourses.forEach(code => {
        const prereqs = adjList.get(code) || new Set();
        prereqs.forEach(pre => {
          if (!addedNodes.has(pre)) {
            // pre is in another faculty (supporting node)
            const course = coursesMap.get(pre);
            const hist = course ? null : historicalCoursesInfo.get(pre);
            // Each of the two "not offered" kinds answers to its own checkbox
            if (hist && !showAllHistoricalCourses) {
              return;
            }
            if (!course && !hist && !showExternalCourses) {
              return;
            }
            let nodeObj = {
              id: pre,
              borderWidth: 1.5,
              font: { size: baseNodeFontSize - 0.5 }
            };

            if (course) {
              const fac = course.general["פקולטה"];
              nodeObj.label = wrapText(course.general["שם מקצוע"], 15);
              nodeObj.title = buildNodeTooltip(pre, 'supporting');
              // Supporting node style: dark background, dashed colored border, muted text
              nodeObj.color = {
                background: isLightTheme ? 'rgba(240, 240, 245, 0.95)' : 'rgba(10, 10, 15, 0.95)',
                border: getFacultyColor(fac),
                highlight: { 
                  background: isLightTheme ? 'rgba(230, 230, 235, 0.95)' : 'rgba(20, 20, 25, 0.95)', 
                  border: isLightTheme ? '#111827' : '#ffffff' 
                }
              };
              nodeObj.borderWidth = 2;
              nodeObj.shapeProperties = { borderDashes: [4, 4] };
              nodeObj.font = { color: isLightTheme ? '#4b5563' : '#a1a1aa', size: baseNodeFontSize - 0.5 };
            } else if (hist) {
              // Runs in other semesters, just not this one
              nodeObj.label = wrapText(hist.general["שם מקצוע"], 15);
              nodeObj.title = buildNodeTooltip(pre, 'other-semester');
              applyUnofferedNodeStyle(nodeObj, OTHER_SEMESTER_STYLE, isLightTheme);
            } else {
              // Only ever seen inside a prerequisite list
              nodeObj.label = pre;
              nodeObj.title = buildNodeTooltip(pre, 'external');
              applyUnofferedNodeStyle(nodeObj, EXTERNAL_STYLE, isLightTheme);
            }

            nodes.push(nodeObj);
            addedNodes.add(pre);
          }
        });
      });

    // Create edges between all added nodes
    addedNodes.forEach(code => {
      const prereqs = adjList.get(code);
      if (prereqs) {
        prereqs.forEach(pre => {
          if (addedNodes.has(pre)) {
            const edgeId = `${pre}->${code}`;
            if (!addedEdges.has(edgeId)) {
              const isSelectedPath = (pre === selectedCourseCode || code === selectedCourseCode);
              edges.push({
                id: edgeId,
                from: pre,
                to: code,
                color: isSelectedPath ? '#8b5cf6' : (isLightTheme ? 'rgba(124, 58, 237, 0.35)' : 'rgba(139, 92, 246, 0.35)'),
                width: isSelectedPath ? 2.5 : 1.2,
                arrows: { to: { enabled: true, scaleFactor: 0.6 } }
              });
              addedEdges.add(edgeId);
            }
          }
        });
      }

      const coReqs = coReqList.get(code);
      if (coReqs) {
        coReqs.forEach(co => {
          if (addedNodes.has(co)) {
            const edgeId1 = `${code}<->${co}`;
            const edgeId2 = `${co}<->${code}`;
            if (!addedEdges.has(edgeId1) && !addedEdges.has(edgeId2)) {
              edges.push({
                id: edgeId1,
                from: code,
                to: co,
                color: '#3b82f6',
                width: 0.8,
                dashes: true,
                arrows: { to: { enabled: true, scaleFactor: 0.4 }, from: { enabled: true, scaleFactor: 0.4 } }
              });
              addedEdges.add(edgeId1);
            }
          }
        });
      }
    });
  }

  return { nodes, edges };
}

// Render Graph using Vis.js
function renderGraph() {
  const container = document.getElementById("network-canvas");
  const { nodes, edges } = generateGraphData();

  networkNodes = new vis.DataSet(nodes);
  networkEdges = new vis.DataSet(edges);

  const data = {
    nodes: networkNodes,
    edges: networkEdges
  };

  // Vis.js Options configuration
  const options = {
    layout: {
      randomSeed: 42
    },
    physics: {
      enabled: true,
      stabilization: {
        enabled: true,
        iterations: 120,
        updateInterval: 25
      },
      // The dense setting pulls nodes closer together, but avoidOverlap still
      // keeps the boxes off each other so the labels stay readable.
      barnesHut: {
        gravitationalConstant: useCompression ? -4500 : -12000,
        centralGravity: useCompression ? 0.25 : 0.1,
        springLength: useCompression ? 110 : 220,
        springConstant: useCompression ? 0.03 : 0.02,
        damping: 0.09,
        avoidOverlap: 1
      }
    },
    edges: {
      smooth: {
        type: 'continuous',
        roundness: 0.3
      }
    },
    nodes: {
      shape: 'box',
      margin: { top: 10, bottom: 10, left: 14, right: 14 },
      shapeProperties: {
        borderRadius: 8
      },
      font: {
        face: 'Heebo, Outfit, sans-serif',
        color: '#ffffff'
      },
      scaling: {
        label: {
          enabled: true,
          drawThreshold: 1,
          maxVisible: 1000
        }
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      hideEdgesOnDrag: true,
      hideEdgesOnZoom: true
    }
  };

  // Use Hierarchical Layout for Local Centric Graph or custom hierarchical layout
  if (viewMode === 'local' || useHierarchicalLayout) {
    options.physics = { enabled: false }; // Disable simulation for hierarchy
    options.layout = {
      hierarchical: {
        direction: 'UD', // Up-Down (top to bottom)
        sortMethod: 'directed',
        nodeSpacing: useCompression ? 130 : 220,
        levelSeparation: useCompression ? 110 : 180,
        shakeTowards: 'leaves'
      }
    };
  }

  // Destroy existing network
  if (network) {
    network.destroy();
  }

  // Instantiate new Vis.js network
  network = new vis.Network(container, data, options);

  // Add listeners
  network.on("click", (params) => {
    if (params.nodes.length > 0) {
      const clickedCode = params.nodes[0];
      selectCourse(clickedCode);
    }
  });

  // Right-click on a node → show context menu
  network.on("oncontext", (params) => {
    params.event.preventDefault();
    hideNodeContextMenu();
    const nodeId = network.getNodeAt(params.pointer.DOM);
    if (nodeId) {
      showNodeContextMenu(nodeId, params.event.clientX, params.event.clientY);
    }
  });

  network.on("stabilizationProgress", (params) => {
    const progress = Math.round((params.iterations / params.total) * 100);
    showLoading(`מייצב את הגרף... ${progress}%`);
  });

  network.on("stabilizationIterationsDone", () => {
    hideLoading();
    if (viewMode !== 'local' && !useHierarchicalLayout) {
      // Disable physics to prevent jitter after stabilization
      network.setOptions({ physics: { enabled: false } });
    }
    if (savedView) {
      network.moveTo({
        position: savedView.position,
        scale: savedView.scale,
        animation: false
      });
      savedView = null;
    }
  });

  // Trigger fit to screen on loaded
  if (viewMode === 'local' || useHierarchicalLayout) {
    setTimeout(() => {
      if (savedView) {
        network.moveTo({
          position: savedView.position,
          scale: savedView.scale,
          animation: false
        });
        savedView = null;
      } else {
        network.fit({ animation: true });
      }
    }, 150);
  }

  updateLegend();
}

// Select a course and show in Details sidebar
function selectCourse(courseCode) {
  selectedCourseCode = courseCode;

  // Highlight node in graph if it exists
  if (network) {
    const nodeExists = networkNodes && networkNodes.get(courseCode) !== null;
    if (nodeExists) {
      network.selectNodes([courseCode]);
      // Focus camera
      try {
        network.focus(courseCode, {
          scale: 1.1,
          animation: { duration: 500, easingFunction: 'easeInOutQuad' }
        });
      } catch (e) {
        console.warn("Could not focus node:", e);
      }
    } else {
      network.unselectAll();
    }
    
    // Dynamically re-dye edges connected to the newly selected node
    updateEdgeStyles();
  }

  // Update sidebar text
  updateDetailsPanel();
}

// Unselect the selected course
function unselectCourse() {
  selectedCourseCode = null;
  if (network) {
    network.unselectAll();
    updateEdgeStyles(); // Reset edge colors
  }
  // Return to faculty view if in local view since local requires selection
  if (viewMode === 'local') {
    viewMode = 'faculty';
    document.getElementById("btn-view-faculty").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    restoreFacultyFilters();
    updateLayoutToggleBtnVisibility();
  }
  renderGraph();
  updateDetailsPanel();
}

// Re-dye (re-color) edges dynamically to highlight connections to the selected course
function updateEdgeStyles() {
  if (!network || !networkEdges) return;
  const isLightTheme = document.body.classList.contains("light-theme");
  const normalColor = isLightTheme ? 'rgba(124, 58, 237, 0.35)' : 'rgba(139, 92, 246, 0.35)';
  const activeColor = '#8b5cf6';

  const updates = [];
  networkEdges.forEach(edge => {
    // Check if this edge is connected to the selected course
    const isSelectedPath = selectedCourseCode && (edge.from === selectedCourseCode || edge.to === selectedCourseCode);
    
    let newColor;
    let newWidth;
    
    if (edge.dashes) {
      // Co-requisite edge
      newColor = isSelectedPath ? '#3b82f6' : (isLightTheme ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.25)');
      newWidth = isSelectedPath ? 1.5 : 0.8;
    } else {
      // Regular prerequisite edge
      newColor = isSelectedPath ? activeColor : normalColor;
      newWidth = isSelectedPath ? 2.5 : 1.2;
    }

    if (edge.color !== newColor || edge.width !== newWidth) {
      updates.push({
        id: edge.id,
        color: newColor,
        width: newWidth
      });
    }
  });

  if (updates.length > 0) {
    networkEdges.update(updates);
  }
}

// Refresh Details UI
function updateDetailsPanel() {
  const container = document.getElementById("details-scroll-area");

  if (!selectedCourseCode) {
    container.innerHTML = `
      <div class="welcome-panel">
        <i class="fa-solid fa-circle-nodes"></i>
        <h3>חקור את קורסי הטכניון</h3>
        <p>חפש קורס בתיבת החיפוש למעלה או לחץ על קורס כלשהו בגרף על מנת לצפות בדרישות הקדם שלו, המקצועות שהוא פותח, סילבוס, לוח בחינות ושעות הרצאה.</p>
      </div>
    `;
    return;
  }

  const course = coursesMap.get(selectedCourseCode) || historicalCoursesInfo.get(selectedCourseCode);
  const isOfferedThisSemester = coursesMap.has(selectedCourseCode);

  if (!course) {
    // Only ever seen inside a prerequisite list - nothing is known about it beyond
    // the fact that other courses require it.
    const facultyColor = EXTERNAL_STYLE.border;
    const requiredBy = Array.from(revAdjList.get(selectedCourseCode) || []);
    const requiredByText = requiredBy.length > 0
      ? requiredBy.map(courseDisplayName).join(", ")
      : "אינו מופיע כדרישת קדם של קורס כלשהו";

    container.innerHTML = `
      <div class="course-card" style="--faculty-color: ${facultyColor}">
        <div class="course-card-header">
          <h2 class="course-card-title">קורס חיצוני</h2>
          <div class="course-card-code">${selectedCourseCode}</div>
        </div>
        <div class="course-meta-grid">
          <div class="meta-item">
            <span class="meta-label">פקולטה</span>
            <span class="meta-value">לא ידוע</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">נקודות</span>
            <span class="meta-value points-badge">לא ידוע</span>
          </div>
          <div class="meta-item" style="grid-column: span 2; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 8px;">
            <span class="meta-label">נדרש עבור</span>
            <span class="meta-value" style="color: var(--secondary); font-weight: 500; font-size: 12.5px;">${requiredByText}</span>
          </div>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 15px; line-height: 1.4;">
          מספר הקורס מופיע כדרישת קדם, אך הקורס עצמו לא נמצא באף אחד מהסמסטרים שבנתונים. ייתכן שמדובר בקורס ישן, בקורס ממוסד אחר, או בקורס שהוחלף במספר חדש.
        </p>
        <div class="card-actions" style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="btn btn-primary" onclick="toggleLocalView(true)" style="width: 100%;">
            <i class="fa-solid fa-diagram-project"></i> התמקדות בגרף
          </button>
          <button class="btn" onclick="unselectCourse()" title="ביטול בחירת קורס" style="flex: 0 0 auto; width: 44px; padding: 0;" aria-label="ביטול בחירה">
            <i class="fa-solid fa-xmark" style="font-size: 16px;"></i>
          </button>
        </div>
      </div>
    `;
    return;
  }

  const gen = course.general;
  const facultyColor = getFacultyColor(gen["פקולטה"]);

  // Direct & Recursive lists
  const directPrereqs = parsePrerequisites(gen["מקצועות קדם"]);
  const directUnlocks = Array.from(revAdjList.get(selectedCourseCode) || []);

  const directPrereqsSet = new Set(directPrereqs);
  const recursivePrereqs = Array.from(getRecursivePrereqs(selectedCourseCode))
    .filter(c => c !== selectedCourseCode && !directPrereqsSet.has(c));

  const directUnlocksSet = new Set(directUnlocks);
  const recursiveUnlocks = Array.from(getRecursiveUnlocks(selectedCourseCode))
    .filter(c => c !== selectedCourseCode && !directUnlocksSet.has(c));

  // Filter based on showExternalCourses
  let displayPrereqs = directPrereqs;
  let displayUnlocks = directUnlocks;
  let displayRecPrereqs = recursivePrereqs;
  let displayRecUnlocks = recursiveUnlocks;


  // Determine if course has a final exam
  const hasExam = (gen["מועד א"] || gen["מועד ב"]) ? "כן" : "לא";

  // Get semesters in which this course is offered
  const [curYear, curSem] = currentSemester.split("-");
  const currentSemName = semesterLabel(curYear, curSem);

  const offeredSems = courseSemestersMap.get(selectedCourseCode);
  const semsText = offeredSems ? Array.from(offeredSems).join(", ") : currentSemName;

  // Which semester the details below actually describe. Staff, schedule and exam dates
  // all change between semesters, so say so rather than implying it's current.
  const dataSource = historicalCourseSource.get(selectedCourseCode);
  const dataSemName = isOfferedThisSemester
    ? currentSemName
    : (dataSource ? dataSource.label : currentSemName);

  const staleBanner = isOfferedThisSemester ? '' : `
      <div style="font-size: 12.5px; color: var(--warning); background: rgba(245, 158, 11, 0.10); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; line-height: 1.4;">
        <i class="fa-solid fa-clock-rotate-left"></i>
        הקורס אינו מוצע בסמסטר ${currentSemName}. הפרטים להלן הם מסמסטר ${dataSemName} וייתכן שישתנו.
      </div>
  `;

  // Course-responsible staff, which changes between semesters
  const responsible = getResponsible(course);
  const responsibleText = responsible.length > 0 ? responsible.join(", ") : "לא פורסם";

  // Prefer the grouped and/or view. A handful of courses have malformed prerequisite
  // strings that don't parse, and those fall back to the old flat list.
  const prereqTree = parsePrereqTree(gen["מקצועות קדם"]);
  let prereqBody;
  if (displayPrereqs.length === 0) {
    prereqBody = '<div class="req-empty">אין דרישות ישירות</div>';
  } else if (prereqTree) {
    prereqBody = renderPrereqTree(prereqTree);
  } else {
    prereqBody = `<div class="req-list">${displayPrereqs.map(renderReqLink).join('')}</div>`;
  }

  const rawPrereqRow = gen["מקצועות קדם"] ? `
        <details class="req-raw">
          <summary>לוגיקת הדרישה כפי שמופיעה במערכת</summary>
          <span class="req-raw-value">${gen["מקצועות קדם"]}</span>
        </details>
  ` : '';

  let html = `
    <!-- Course Title & Code -->
    <div class="course-card" style="--faculty-color: ${facultyColor}">
      <div class="course-card-header">
        <h2 class="course-card-title">${gen["שם מקצוע"]}</h2>
        <div class="course-card-code">${selectedCourseCode}</div>
      </div>
      ${staleBanner}
      <div class="course-meta-grid">
        <div class="meta-item">
          <span class="meta-label">פקולטה</span>
          <span class="meta-value">${gen["פקולטה"]}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">נקודות</span>
          <span class="meta-value points-badge">${gen["נקודות"]}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">מסגרת לימודים</span>
          <span class="meta-value">${gen["מסגרת לימודים"] || 'לא צוין'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">מבחן סופי</span>
          <span class="meta-value" style="color: ${hasExam === 'כן' ? 'var(--warning)' : 'var(--accent)'}; font-weight: bold;">${hasExam}</span>
        </div>
        <div class="meta-item" style="grid-column: span 2; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 8px;">
          <span class="meta-label">אחראי/ת הקורס (סמסטר ${dataSemName})</span>
          <span class="meta-value" style="font-weight: 500; font-size: 12.5px; ${responsible.length > 0 ? '' : 'color: var(--text-muted); font-style: italic;'}">${responsibleText}</span>
        </div>
        <div class="meta-item" style="grid-column: span 2; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 8px;">
          <span class="meta-label">סמסטרים שבהם נלמד</span>
          <span class="meta-value" style="color: var(--secondary); font-weight: 500; font-size: 12.5px;">${semsText}</span>
        </div>
      </div>
      <div class="card-actions" style="display: flex; gap: 8px; margin-top: 10px;">
        <button class="btn btn-primary" onclick="toggleLocalView(true)" title="הצג רק את הקורסים הקשורים לקורס זה">
          <i class="fa-solid fa-diagram-project"></i> התמקדות בגרף
        </button>
        <button class="btn" onclick="unselectCourse()" title="ביטול בחירת קורס" style="flex: 0 0 auto; width: 44px; padding: 0;" aria-label="ביטול בחירה">
          <i class="fa-solid fa-xmark" style="font-size: 16px;"></i>
        </button>
      </div>
    </div>

    <!-- Prerequisite Details (What it needs) -->
    <div class="info-section">
      <div class="info-section-header" onclick="toggleSection(this)">
        <span class="info-section-title">
          <i class="fa-solid fa-arrow-left-long"></i> דרישות קדם ישירות (${displayPrereqs.length})
        </span>
        <i class="fa-solid fa-chevron-up chevron"></i>
      </div>
      <div class="info-section-content">
        ${prereqBody}
        ${rawPrereqRow}
      </div>
    </div>

    <!-- Recursive Prerequisite Details (Indirect) -->
    <div class="info-section collapsed">
      <div class="info-section-header" onclick="toggleSection(this)">
        <span class="info-section-title">
          <i class="fa-solid fa-folder-tree"></i> דרישות עקיפות (רקורסיבי) (${displayRecPrereqs.length})
        </span>
        <i class="fa-solid fa-chevron-up chevron"></i>
      </div>
      <div class="info-section-content">
        <div class="req-list">
          ${displayRecPrereqs.length > 0 ? displayRecPrereqs.map(code => renderReqLink(code)).join('') : '<div class="req-empty">אין דרישות עקיפות נוספות</div>'}
        </div>
      </div>
    </div>

    <!-- Unlock Details (What it unlocks) -->
    <div class="info-section">
      <div class="info-section-header" onclick="toggleSection(this)">
        <span class="info-section-title">
          <i class="fa-solid fa-arrow-right-long"></i> פותח קורסים ישירות (${displayUnlocks.length})
        </span>
        <i class="fa-solid fa-chevron-up chevron"></i>
      </div>
      <div class="info-section-content">
        <div class="req-list">
          ${displayUnlocks.length > 0 ? displayUnlocks.map(code => renderReqLink(code)).join('') : '<div class="req-empty">אינו מהווה דרישת קדם ישירה לאף קורס סמסטר זה</div>'}
        </div>
      </div>
    </div>

    <!-- Recursive Unlock Details (Indirect) -->
    <div class="info-section collapsed">
      <div class="info-section-header" onclick="toggleSection(this)">
        <span class="info-section-title">
          <i class="fa-solid fa-diagram-next"></i> פתיחות עקיפות (שרשרת פתיחות) (${displayRecUnlocks.length})
        </span>
        <i class="fa-solid fa-chevron-up chevron"></i>
      </div>
      <div class="info-section-content">
        <div class="req-list">
          ${displayRecUnlocks.length > 0 ? displayRecUnlocks.map(code => renderReqLink(code)).join('') : '<div class="req-empty">אינו פותח קורסים נוספים בעתיד</div>'}
        </div>
      </div>
    </div>
  `;

  // Co-requisites & Mutually Exclusive (if present)
  const coReqStr = gen["מקצועות צמודים"];
  const noCreditStr = gen["מקצועות ללא זיכוי נוסף"] || gen["מקצועות ללא זיכוי נוסף (מכילים)"] || gen["מקצועות ללא זיכוי נוסף (מוכלים)"];

  if (coReqStr || noCreditStr) {
    html += `
      <div class="info-section collapsed">
        <div class="info-section-header" onclick="toggleSection(this)">
          <span class="info-section-title">
            <i class="fa-solid fa-link-slash"></i> מקצועות צמודים וללא זיכוי
          </span>
          <i class="fa-solid fa-chevron-up chevron"></i>
        </div>
        <div class="info-section-content">
          ${coReqStr ? `
            <div class="req-item-group">
              <div class="req-group-title">מקצועות צמודים (לקיחה יחד):</div>
              <div class="req-list">
                ${coReqStr.split(/\s+/).map(code => renderReqLink(code)).join('')}
              </div>
            </div>
          ` : ''}
          ${noCreditStr ? `
            <div class="req-item-group">
              <div class="req-group-title">חפיפת תכנים (ללא זיכוי נוסף):</div>
              <div style="font-size: 13px; color: var(--danger); line-height: 1.4;">
                ${[gen["מקצועות ללא זיכוי נוסף"], gen["מקצועות ללא זיכוי נוסף (מכילים)"], gen["מקצועות ללא זיכוי נוסף (מוכלים)"]]
          .filter(Boolean).join(' ')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Syllabus & Notes
  html += `
    <div class="info-section">
      <div class="info-section-header" onclick="toggleSection(this)">
        <span class="info-section-title">
          <i class="fa-solid fa-book-open"></i> סילבוס ותיאור
        </span>
        <i class="fa-solid fa-chevron-up chevron"></i>
      </div>
      <div class="info-section-content" style="white-space: pre-line;">
        ${gen["סילבוס"] || 'לא הוזן סילבוס עבור מקצוע זה.'}
        
        ${gen["הערות"] ? `
          <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
            <div style="font-weight: 600; color: var(--warning); margin-bottom: 6px;">הערות סמסטריאליות:</div>
            <p style="font-size: 12.5px; color: var(--text-secondary);">${gen["הערות"]}</p>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  if (isOfferedThisSemester) {
    // Exam Dates (if present)
    const examsList = [
      { name: "מועד א'", key: "מועד א" },
      { name: "מועד ב'", key: "מועד ב" },
      { name: "בוחן א'", key: "בוחן מועד א" },
      { name: "בוחן ב'", key: "בוחן מועד ב" }
    ].filter(ex => gen[ex.key]);

    if (examsList.length > 0) {
      html += `
        <div class="info-section collapsed">
          <div class="info-section-header" onclick="toggleSection(this)">
            <span class="info-section-title">
              <i class="fa-solid fa-calendar-days"></i> לוח בחינות
            </span>
            <i class="fa-solid fa-chevron-up chevron"></i>
          </div>
          <div class="info-section-content">
            <table class="exams-table">
              <thead>
                <tr>
                  <th>מועד</th>
                  <th>תאריך ושעה</th>
                </tr>
              </thead>
              <tbody>
                ${examsList.map(ex => `
                  <tr>
                    <td style="font-weight: 500;">${ex.name}</td>
                    <td class="exam-date-cell">${gen[ex.key]}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Lectures & Tutorials Schedules (if present)
    const schedule = course.schedule;
    if (schedule && schedule.length > 0) {
      // Group schedule items by group code/lecturer/type
      html += `
        <div class="info-section collapsed">
          <div class="info-section-header" onclick="toggleSection(this)">
            <span class="info-section-title">
              <i class="fa-solid fa-clock"></i> שעות הרצאות ותרגולים
            </span>
            <i class="fa-solid fa-chevron-up chevron"></i>
          </div>
          <div class="info-section-content">
            <div class="schedules-container">
              ${schedule.map(item => `
                <div class="schedule-card">
                  <div class="schedule-header">
                    <span>קבוצה ${item["קבוצה"]} (${item["סוג"]})</span>
                    <span>מס. ${item["מס."]}</span>
                  </div>
                  <div class="schedule-row">
                    <span class="schedule-label">יום ושעה</span>
                    <span class="schedule-val-time">יום ${item["יום"]}, ${item["שעה"]}</span>
                  </div>
                  <div class="schedule-row">
                    <span class="schedule-label">מיקום</span>
                    <span>${item["בניין"] ? `${item["בניין"]}, חדר ${item["חדר"]}` : 'לא צוין מיקום'}</span>
                  </div>
                  ${item["מרצה/מתרגל"] ? `
                    <div class="schedule-row">
                      <span class="schedule-label">סגל</span>
                      <span style="font-size:12px;">${item["מרצה/מתרגל"].replace(/\n/g, ', ')}</span>
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

// Render small link card for prereqs/unlocks lists. The border colour matches the
// node colours in the graph, so the three statuses read the same in both places.
function renderReqLink(code) {
  const target = coursesMap.get(code);
  let name;
  let accent = "";

  if (target) {
    name = target.general["שם מקצוע"];
  } else {
    const hist = historicalCoursesInfo.get(code);
    if (hist) {
      name = hist.general["שם מקצוע"] + " (לא מוצע הסמסטר)";
      accent = OTHER_SEMESTER_STYLE.border;
    } else {
      name = "קורס חיצוני - לא נמצא בנתונים";
      accent = EXTERNAL_STYLE.border;
    }
  }

  const accentStyle = accent ? ` style="border-right: 3px solid ${accent};"` : "";
  return `
    <div class="req-link" onclick="selectCourse('${code}')"${accentStyle}>
      <span class="req-link-text" title="${name}">${name}</span>
      <span class="req-link-code">${code}</span>
    </div>
  `;
}

// Render a run of sibling nodes joined by `op`: consecutive plain courses share one
// card list, while a nested group gets its own boxed section with the operator
// spelled out between the parts.
function renderPrereqChildren(children, op) {
  const segments = [];
  let pending = [];

  const flush = () => {
    if (pending.length === 0) return;
    segments.push(`<div class="req-list">${pending.map(renderReqLink).join("")}</div>`);
    pending = [];
  };

  children.forEach(child => {
    if (child.code) {
      pending.push(child.code);
    } else {
      flush();
      const isOr = child.op === "or";
      segments.push(`
        <div class="req-subgroup ${isOr ? "req-subgroup-or" : "req-subgroup-and"}">
          <div class="req-subgroup-title">${isOr ? "אחד מהבאים" : "כל הבאים"}</div>
          ${renderPrereqChildren(child.children, child.op)}
        </div>
      `);
    }
  });

  flush();
  return segments.join(`<div class="req-join">${op === "or" ? "או" : "וגם"}</div>`);
}

// Render the and/or tree so alternative groups read as separate options rather
// than one undifferentiated list of courses.
function renderPrereqTree(tree) {
  if (!tree) return "";

  if (tree.code) {
    return `<div class="req-list">${renderReqLink(tree.code)}</div>`;
  }

  if (tree.op === "and") {
    return `
      <div class="req-group">
        <div class="req-group-title">נדרשים <strong>כל</strong> הקורסים הבאים:</div>
        ${renderPrereqChildren(tree.children, "and")}
      </div>
    `;
  }

  // When every alternative is a single course, the boxes and "אפשרות N" badges are
  // more noise than help - just the cards with "או" between them is clearer.
  const allSingle = tree.children.every(child => child.code);

  const options = tree.children.map((child, index) => `
    <div class="req-option${allSingle ? " req-option-plain" : ""}">
      ${allSingle ? "" : `<div class="req-option-badge">אפשרות ${index + 1}</div>`}
      ${child.code
        ? `<div class="req-list">${renderReqLink(child.code)}</div>`
        : renderPrereqChildren(child.children, "and")}
    </div>
  `).join("");

  return `
    <div class="req-group">
      <div class="req-group-title">מספיק להשלים <strong>אחת</strong> מהאפשרויות הבאות:</div>
      ${options}
    </div>
  `;
}

// Toggle collapsible sidebar card sections
function toggleSection(headerElement) {
  const section = headerElement.parentElement;
  section.classList.toggle("collapsed");
}

// Reset all filters to their inclusive state
function resetFiltersToInclusive() {
  // Exams
  examFilter = 'all';
  document.getElementById("btn-exam-all").classList.add("active");
  document.getElementById("btn-exam-yes").classList.remove("active");
  document.getElementById("btn-exam-no").classList.remove("active");

  // Days
  activeDays.clear();
  document.querySelectorAll(".day-tag").forEach(btn => btn.classList.remove("active"));

  // Faculties
  faculties.forEach(fac => {
    activeFaculties.add(fac);
  });
  document.querySelectorAll(".faculty-tag").forEach(tag => tag.classList.add("active"));

  // Bottom checkboxes
  showAllHistoricalCourses = true;
  document.getElementById("chk-show-historical").checked = true;

  showExternalCourses = true;
  document.getElementById("chk-show-external").checked = true;

  showSportsCourses = true;
  document.getElementById("chk-show-sports").checked = true;
}

let savedFacultyFilters = null;

// Backup current faculty filter states
function backupFacultyFilters() {
  savedFacultyFilters = {
    examFilter: examFilter,
    activeDays: new Set(activeDays),
    activeFaculties: new Set(activeFaculties),
    showAllHistoricalCourses: showAllHistoricalCourses,
    showExternalCourses: showExternalCourses,
    showSportsCourses: showSportsCourses
  };
}

// Restore saved faculty filter states and update the UI controls
function restoreFacultyFilters() {
  if (!savedFacultyFilters) return;

  examFilter = savedFacultyFilters.examFilter;
  activeDays = new Set(savedFacultyFilters.activeDays);
  activeFaculties = new Set(savedFacultyFilters.activeFaculties);
  showAllHistoricalCourses = savedFacultyFilters.showAllHistoricalCourses;
  showExternalCourses = savedFacultyFilters.showExternalCourses;
  showSportsCourses = savedFacultyFilters.showSportsCourses;

  // 1. Exam filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    if (btn.dataset.value === examFilter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 2. Days tags
  document.querySelectorAll(".day-tag").forEach(btn => {
    const day = btn.dataset.value;
    if (activeDays.has(day)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 3. Faculty tags
  document.querySelectorAll(".faculty-tag").forEach(tag => {
    const fac = tag.dataset.faculty;
    if (activeFaculties.has(fac)) {
      tag.classList.add("active");
    } else {
      tag.classList.remove("active");
    }
  });

  // 4. Checkboxes
  document.getElementById("chk-show-historical").checked = showAllHistoricalCourses;
  document.getElementById("chk-show-external").checked = showExternalCourses;
  document.getElementById("chk-show-sports").checked = showSportsCourses;

  savedFacultyFilters = null;
}

// The focused tree forces its own hierarchical layout, so the toggle only applies to the faculty graph
function updateLayoutToggleBtnVisibility() {
  const btn = document.getElementById("layout-toggle-btn");
  if (btn) {
    btn.style.display = (viewMode !== 'local') ? 'flex' : 'none';
  }
}

// Dynamic font resizing in-place without rebuilding the network
function updateNodeFontSizesInPlace() {
  if (!networkNodes) return;
  const updates = [];
  networkNodes.forEach(node => {
    const isSelected = (node.id === selectedCourseCode);
    const course = coursesMap.get(node.id);
    const hist = historicalCoursesInfo.get(node.id);
    const isCore = course || hist;
    
    let size = baseNodeFontSize;
    if (isCore) {
      size = isSelected ? (baseNodeFontSize + 2) : baseNodeFontSize;
    } else {
      size = baseNodeFontSize - 0.5;
    }
    
    const currentFont = node.font || {};
    updates.push({
      id: node.id,
      font: {
        ...currentFont,
        size: size
      }
    });
  });
  networkNodes.update(updates);
}

// Toggle Local / Faculty view mode
function toggleLocalView(enableLocal) {
  if (enableLocal) {
    if (viewMode === 'faculty') {
      backupFacultyFilters();
    }
    viewMode = 'local';
    document.getElementById("btn-view-local").classList.add("active");
    document.getElementById("btn-view-faculty").classList.remove("active");
    resetFiltersToInclusive();
  } else {
    viewMode = 'faculty';
    document.getElementById("btn-view-faculty").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    restoreFacultyFilters();
  }
  updateLayoutToggleBtnVisibility();
  renderGraph();
  if (selectedCourseCode) {
    setTimeout(() => selectCourse(selectedCourseCode), 200);
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Semester change
  document.getElementById("semester-select").addEventListener("change", (e) => {
    currentSemester = e.target.value;
    loadSemesterData(currentSemester);
  });

  // Search inputs
  const searchInput = document.getElementById("course-search");
  const suggestions = document.getElementById("search-suggestions");
  const clearBtn = document.getElementById("clear-search-btn");

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim().toLowerCase();

    if (val.length > 0) {
      clearBtn.style.display = "block";
    } else {
      clearBtn.style.display = "none";
    }

    if (val.length < 2) {
      suggestions.style.display = "none";
      return;
    }

    // Filter courses matching code or name across all known courses
    const matches = [];
    const addedToSearch = new Set();
    
    // First, add from current semester
    for (const [code, course] of coursesMap.entries()) {
      const name = course.general["שם מקצוע"].toLowerCase();
      if (code.includes(val) || name.includes(val)) {
        matches.push({ code, name: course.general["שם מקצוע"] });
        addedToSearch.add(code);
      }
      if (matches.length >= 10) break;
    }
    
    // If we need more, add from historical courses
    if (matches.length < 10) {
      for (const [code, hist] of historicalCoursesInfo.entries()) {
        if (addedToSearch.has(code)) continue;
        const name = hist.general["שם מקצוע"].toLowerCase();
        if (code.includes(val) || name.includes(val)) {
          matches.push({ code, name: hist.general["שם מקצוע"] + " (מסמסטר אחר)" });
          addedToSearch.add(code);
        }
        if (matches.length >= 10) break;
      }
    }

    if (matches.length > 0) {
      suggestions.innerHTML = "";
      matches.forEach(m => {
        const item = document.createElement("div");
        item.className = "suggestion-item";

        const text = document.createElement("span");
        text.className = "course-name";
        text.textContent = m.name;

        const code = document.createElement("span");
        code.className = "course-code";
        code.textContent = m.code;

        item.appendChild(text);
        item.appendChild(code);

        item.addEventListener("click", () => {
          searchInput.value = m.name;
          suggestions.style.display = "none";
          selectCourse(m.code);
        });

        suggestions.appendChild(item);
      });
      suggestions.style.display = "block";
    } else {
      suggestions.style.display = "none";
    }
  });

  // Close suggestions list on click outside
  document.addEventListener("click", (e) => {
    if (e.target !== searchInput) {
      suggestions.style.display = "none";
    }
  });

  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.style.display = "none";
    suggestions.style.display = "none";
  });

  // View mode controls
  document.getElementById("btn-view-faculty").addEventListener("click", () => {
    const wasLocal = viewMode === 'local';
    viewMode = 'faculty';
    document.getElementById("btn-view-faculty").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    if (wasLocal) {
      restoreFacultyFilters();
    }
    updateLayoutToggleBtnVisibility();
    renderGraph();
  });

  document.getElementById("btn-view-local").addEventListener("click", () => {
    if (!selectedCourseCode) {
      alert("אנא בחר קורס קודם מתיבת החיפוש או מהגרף הראשי כדי לראות את העץ הממוקד שלו.");
      return;
    }
    toggleLocalView(true);
  });

  // Floating Graph Controls
  document.getElementById("zoom-in-btn").addEventListener("click", () => {
    if (network) {
      const scale = network.getScale();
      network.moveTo({ scale: scale * 1.2 });
    }
  });

  document.getElementById("zoom-out-btn").addEventListener("click", () => {
    if (network) {
      const scale = network.getScale();
      network.moveTo({ scale: scale / 1.2 });
    }
  });

  document.getElementById("fit-btn").addEventListener("click", () => {
    if (network) {
      network.fit({ animation: true });
    }
  });

  document.getElementById("layout-toggle-btn").addEventListener("click", () => {
    useHierarchicalLayout = !useHierarchicalLayout;
    const btn = document.getElementById("layout-toggle-btn");
    if (useHierarchicalLayout) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    renderGraph();
  });

  document.getElementById("compress-toggle-btn").addEventListener("click", () => {
    saveCurrentView();
    useCompression = !useCompression;
    const btn = document.getElementById("compress-toggle-btn");
    if (useCompression) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    // Lay the graph out again with tighter spacing, rather than scaling the
    // existing coordinates down - that just pushed nodes on top of each other.
    renderGraph();
  });

  document.getElementById("node-size-slider").addEventListener("input", (e) => {
    baseNodeFontSize = parseInt(e.target.value);
    updateNodeFontSizesInPlace();
  });

  // Faculty filtering headers: Select All / Clear All
  document.getElementById("btn-select-all-faculties").addEventListener("click", () => {
    faculties.forEach(f => activeFaculties.add(f));
    document.querySelectorAll(".faculty-tag").forEach(tag => tag.classList.add("active"));
    saveCurrentView();
    renderGraph();
  });

  document.getElementById("btn-clear-all-faculties").addEventListener("click", () => {
    activeFaculties.clear();
    document.querySelectorAll(".faculty-tag").forEach(tag => tag.classList.remove("active"));
    saveCurrentView();
    renderGraph();
  });

  // Advanced Exam Filter Toggles
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      examFilter = e.currentTarget.dataset.value;
      saveCurrentView();
      renderGraph();
    });
  });

  // Advanced Days Filter Toggles
  document.querySelectorAll(".day-tag").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const day = e.currentTarget.dataset.value;
      if (activeDays.has(day)) {
        activeDays.delete(day);
        e.currentTarget.classList.remove("active");
      } else {
        activeDays.add(day);
        e.currentTarget.classList.add("active");
      }
      saveCurrentView();
      renderGraph(); // Re-apply filter to graph
    });
  });

  // Toggle minimizable left filters drawer
  document.getElementById("left-filters-toggle").addEventListener("click", () => {
    document.getElementById("left-filters-panel").classList.toggle("collapsed");
  });

  // Toggle showing historical courses not in the current semester
  document.getElementById("chk-show-historical").addEventListener("change", (e) => {
    showAllHistoricalCourses = e.target.checked;
    saveCurrentView();
    renderGraph();
  });

  // Toggle showing external/non-offered prerequisite courses
  document.getElementById("chk-show-external").addEventListener("change", (e) => {
    showExternalCourses = e.target.checked;
    saveCurrentView();
    renderGraph();
    if (selectedCourseCode) {
      updateDetailsPanel();
    }
  });

  // Switch to/from light theme
  document.getElementById("theme-toggle-btn").addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    
    if (network && networkNodes && networkEdges) {
      const isLightTheme = document.body.classList.contains("light-theme");
      // Update default font colors in options
      network.setOptions({
        nodes: {
          font: {
            color: isLightTheme ? '#111827' : '#ffffff'
          }
        }
      });
      
      // Generate updated node and edge data structures
      const { nodes, edges } = generateGraphData();
      
      // Update the datasets in-place (preserves camera position, zoom, and physics state completely!)
      networkNodes.update(nodes);
      networkEdges.update(edges);
      
      if (selectedCourseCode) {
        network.selectNodes([selectedCourseCode]);
        updateEdgeStyles(); // Update edge colors to match new theme
      }
    } else {
      renderGraph();
    }
  });

  // Toggle showing sports courses
  document.getElementById("chk-show-sports").addEventListener("change", (e) => {
    showSportsCourses = e.target.checked;
    saveCurrentView();
    renderGraph();
    if (selectedCourseCode) {
      updateDetailsPanel();
    }
  });

  // Open the Filtered Courses List Modal
  document.getElementById("btn-open-list").addEventListener("click", () => {
    const modal = document.getElementById("courses-list-modal");
    const searchInput = document.getElementById("modal-search-input");
    
    modal.style.display = "flex";
    searchInput.value = "";

    // Reset the prereqs checkbox to unchecked on every open
    modalShowPrereqs = false;
    document.getElementById("chk-modal-show-prereqs").checked = false;

    // Re-compute filtered courses to ensure consistency with the current graph
    refreshCurrentFilteredCourses();

    populateModalCoursesTable("");
    searchInput.focus();
  });

  // Close the Filtered Courses List Modal
  document.getElementById("modal-close-btn").addEventListener("click", () => {
    document.getElementById("courses-list-modal").style.display = "none";
  });

  // Close modal when clicking on the background overlay
  document.getElementById("courses-list-modal").addEventListener("click", (e) => {
    if (e.target.id === "courses-list-modal") {
      document.getElementById("courses-list-modal").style.display = "none";
    }
  });

  // Filter modal table dynamically as you type
  document.getElementById("modal-search-input").addEventListener("input", (e) => {
    populateModalCoursesTable(e.target.value);
  });

  // Modal "show prereqs" checkbox
  document.getElementById("chk-modal-show-prereqs").addEventListener("change", (e) => {
    modalShowPrereqs = e.target.checked;
    populateModalCoursesTable(document.getElementById("modal-search-input").value);
  });

  // ── Branch Hiding ─────────────────────────────────────────────────────
  // Context menu: hide-branch action
  document.getElementById("ctx-hide-branch").addEventListener("click", () => {
    const menu = document.getElementById("node-context-menu");
    const nodeId = menu.dataset.nodeId;
    if (nodeId) hideCourseBranch(nodeId);
    hideNodeContextMenu();
  });

  // Reset all hidden branches
  document.getElementById("btn-reset-all-hidden").addEventListener("click", resetAllHiddenBranches);

  // Close context menu when clicking anywhere outside it
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("node-context-menu");
    if (!menu.contains(e.target)) hideNodeContextMenu();
  });

  // Close context menu on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideNodeContextMenu();
  });

  // Initial layout button visibility check
  updateLayoutToggleBtnVisibility();
}

// Populate the modal courses table based on search input
function populateModalCoursesTable(query = "") {
  const tableBody = document.getElementById("modal-courses-table-body");
  const countSpan = document.getElementById("modal-courses-count");
  tableBody.innerHTML = "";

  const trimmedQuery = query.trim().toLowerCase();

  // Build the full list of displayable courses from all visible graph nodes
  let allVisibleCourses = [];

  if (networkNodes) {
    networkNodes.forEach(node => {
      const code = node.id;
      const course = coursesMap.get(code) || historicalCoursesInfo.get(code);
      if (course) {
        allVisibleCourses.push(course);
      }
    });
  } else {
    allVisibleCourses = currentFilteredCourses;
  }

  // Determine which courses to hide when "show prereqs" is unchecked
  let hiddenByPrereqFilter = null;
  if (!modalShowPrereqs && networkNodes) {
    hiddenByPrereqFilter = new Set();

    if (viewMode === 'local' && selectedCourseCode) {
      // Local view: hide prerequisite courses (ancestors of the selected course)
      const prereqs = getRecursivePrereqs(selectedCourseCode);
      prereqs.delete(selectedCourseCode); // Don't hide the selected course itself
      prereqs.forEach(code => hiddenByPrereqFilter.add(code));
    } else {
      // Faculty view: hide courses that don't match the active filters
      // (i.e. supporting prereqs pulled in from other faculties)
      const coreCodes = new Set(currentFilteredCourses.map(c => c.general["מספר מקצוע"]));
      allVisibleCourses.forEach(course => {
        const code = course.general["מספר מקצוע"];
        if (!coreCodes.has(code)) {
          hiddenByPrereqFilter.add(code);
        }
      });
    }
  }

  // Filter the list
  const filtered = allVisibleCourses.filter(course => {
    const code = course.general["מספר מקצוע"];

    // Apply prereqs filter
    if (hiddenByPrereqFilter && hiddenByPrereqFilter.has(code)) {
      return false;
    }

    if (!trimmedQuery) return true;
    const lowerCode = (code || "").toLowerCase();
    const name = (course.general["שם מקצוע"] || "").toLowerCase();
    return lowerCode.includes(trimmedQuery) || name.includes(trimmedQuery);
  });

  countSpan.textContent = filtered.length;

  if (filtered.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">אין קורסים תואמים לסינון</td>`;
    tableBody.appendChild(emptyRow);
    return;
  }

  filtered.forEach(course => {
    const code = course.general["מספר מקצוע"];
    const name = course.general["שם מקצוע"];
    const fac = course.general["פקולטה"] || "";
    const points = course.general["נקודות"] || "0";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${code}</td>
      <td><strong>${name}</strong></td>
      <td>${fac}</td>
      <td style="text-align: center;">${points}</td>
    `;

    row.addEventListener("click", () => {
      // Select course in Graph and Sidebar
      selectCourse(code);
      // Close the modal popup
      document.getElementById("courses-list-modal").style.display = "none";
    });

    tableBody.appendChild(row);
  });
}

// Show/Hide loading screen
function showLoading(text) {
  const overlay = document.getElementById("loading-overlay");
  overlay.querySelector(".loading-text").textContent = text;
  overlay.style.display = "flex";
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  overlay.style.display = "none";
}

// ── Branch Hiding / Restore ──────────────────────────────────────────

/**
 * Build a vis.js node object for a course code using the same styling as
 * generateGraphData. Returns null if the code is not in coursesMap and
 * not in historicalCoursesInfo.
 */
function buildNodeObject(code) {
  const isLightTheme = document.body.classList.contains("light-theme");
  const isSelected   = code === selectedCourseCode;
  const course       = coursesMap.get(code);

  if (course) {
    const fac  = course.general["פקולטה"];
    const name = course.general["שם מקצוע"];
    return {
      id: code,
      label: wrapText(name, 15),
      title: buildNodeTooltip(code, 'offered'),
      color: {
        background: isSelected ? hexToRgba(getFacultyColor(fac), 0.8) : hexToRgba(getFacultyColor(fac), isLightTheme ? 0.15 : 0.25),
        border: isSelected ? (isLightTheme ? '#111827' : '#ffffff') : getFacultyColor(fac),
        highlight: {
          background: isSelected ? hexToRgba(getFacultyColor(fac), 0.9) : hexToRgba(getFacultyColor(fac), 0.45),
          border: isLightTheme ? '#111827' : '#ffffff'
        }
      },
      borderWidth: isSelected ? 3 : 2,
      font: { size: isSelected ? (baseNodeFontSize + 2) : baseNodeFontSize, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' },
      shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
    };
  }

  // Runs in other semesters, just not this one
  const hist = historicalCoursesInfo.get(code);
  if (hist) {
    return applyUnofferedNodeStyle({
      id: code,
      label: wrapText(hist.general["שם מקצוע"], 15),
      title: buildNodeTooltip(code, 'other-semester'),
      shadow: false
    }, OTHER_SEMESTER_STYLE, isLightTheme);
  }

  // Only ever seen inside a prerequisite list
  return applyUnofferedNodeStyle({
    id: code,
    label: code,
    title: buildNodeTooltip(code, 'external'),
    shadow: false
  }, EXTERNAL_STYLE, isLightTheme);
}

/**
 * Re-render the graph while preserving the camera viewport (position + zoom).
 * Saves position/scale into pendingViewportRestore before re-rendering;
 * stabilizationIterationsDone will apply it instead of the default fit().
 * In local (hierarchical) view the layout always re-fits automatically so
 * we skip saving.
 */
function renderGraphPreservingViewport() {
  renderGraph();
}

/**
 * Show the custom right-click context menu positioned near the cursor.
 * Computes the branch size (selected node + all transitive unlocks) and
 * displays that count so the user knows the scope before confirming.
 */
function showNodeContextMenu(nodeId, clientX, clientY) {
  const menu = document.getElementById("node-context-menu");
  const course = coursesMap.get(nodeId);
  const name = course ? course.general["שם מקצוע"] : nodeId;

  // Count how many courses will be hidden (root + transitive unlocks)
  const unlockSet = getRecursiveUnlocks(nodeId);
  const totalCount = 1 + unlockSet.size;

  document.getElementById("ctx-hide-label").textContent =
    `הסתר ענף — ${name.length > 22 ? name.slice(0, 22) + '…' : name} (${totalCount} קורסים)`;

  menu.dataset.nodeId = nodeId;

  // Position, clamping to viewport edges
  menu.style.display = "block";
  const menuW = menu.offsetWidth  || 220;
  const menuH = menu.offsetHeight || 50;
  const x = Math.min(clientX, window.innerWidth  - menuW - 8);
  const y = Math.min(clientY, window.innerHeight - menuH - 8);
  menu.style.left = x + "px";
  menu.style.top  = y + "px";
}

/** Hide the context menu without taking action. */
function hideNodeContextMenu() {
  const menu = document.getElementById("node-context-menu");
  menu.style.display = "none";
  delete menu.dataset.nodeId;
}

/**
 * Hide a branch in-place: directly removes the targeted nodes and their
 * connected edges from the live vis.js DataSets without triggering a full
 * re-render. The viewport, physics state, and all other node positions are
 * completely untouched.
 */
function hideCourseBranch(rootCode) {
  const unlockSet = getRecursiveUnlocks(rootCode);
  const codes = new Set([rootCode, ...unlockSet]);

  codes.forEach(c => hiddenCourses.add(c));

  const rootCourse = coursesMap.get(rootCode);
  const rootName   = rootCourse ? rootCourse.general["שם מקצוע"] : rootCode;
  hiddenBranches.push({ root: rootCode, rootName, codes });

  if (networkNodes && networkEdges) {
    // Remove edges first (edge IDs are deterministic: "from->to")
    const edgeIdsToRemove = [];
    networkEdges.forEach(edge => {
      if (codes.has(edge.from) || codes.has(edge.to)) {
        edgeIdsToRemove.push(edge.id);
      }
    });
    if (edgeIdsToRemove.length) networkEdges.remove(edgeIdsToRemove);

    // Remove the nodes themselves, but save their coordinates first
    const nodeIdsToRemove = Array.from(codes).filter(c => networkNodes.get(c) !== null);
    if (nodeIdsToRemove.length) {
      const positions = network.getPositions(nodeIdsToRemove);
      for (const id in positions) {
        hiddenNodePositions[id] = positions[id];
      }
      networkNodes.remove(nodeIdsToRemove);
    }
  }

  // Keep the filtered-courses cache in sync for the popup list
  currentFilteredCourses = currentFilteredCourses.filter(
    c => !codes.has(c.general["מספר מקצוע"])
  );

  updateHiddenBranchesPanel();
}

/**
 * Restore a previously hidden branch by doing a full graph re-render.
 * This ensures restored nodes go through the same filter pipeline as
 * all other nodes, preventing filter-bypassing bugs.
 */
function restoreCourseBranch(rootCode) {
  const idx = hiddenBranches.findIndex(b => b.root === rootCode);
  if (idx === -1) return;
  hiddenBranches.splice(idx, 1);

  // Rebuild hiddenCourses from remaining branches
  hiddenCourses.clear();
  hiddenBranches.forEach(b => b.codes.forEach(c => hiddenCourses.add(c)));

  updateHiddenBranchesPanel();
  saveCurrentView();
  renderGraph();
}

/** Remove all hidden branches and re-render the full graph. */
function resetAllHiddenBranches() {
  hiddenCourses.clear();
  hiddenBranches = [];

  updateHiddenBranchesPanel();
  saveCurrentView();
  renderGraph();
}

/**
 * Internal helper: given a Set of course codes, add any that are currently
 * absent from networkNodes (pass all active filters) back into the DataSets,
 * then run physics briefly to let them settle.
 */
function _addBranchToDataset(codes) {
  if (!networkNodes || !networkEdges || !network) return;

  const isLightTheme = document.body.classList.contains("light-theme");
  const nodesToAdd   = [];
  const edgesToAdd   = [];
  const addedEdges   = new Set(
    networkEdges.map(e => e.id)
  );

  codes.forEach(code => {
    // Only restore if it now passes all active filters
    const course = coursesMap.get(code);
    if (course && !courseMatchesFilters(course)) return;

    // Skip if already visible
    if (networkNodes.get(code) !== null) return;

    const nodeObj = buildNodeObject(code);
    if (nodeObj) {
      if (hiddenNodePositions[code]) {
        nodeObj.x = hiddenNodePositions[code].x;
        nodeObj.y = hiddenNodePositions[code].y;
      }
      nodesToAdd.push(nodeObj);
    }
  });

  if (nodesToAdd.length === 0) return;

  networkNodes.add(nodesToAdd);

  // Now wire up edges between all currently visible nodes + newly added ones
  const visibleNodes = new Set(networkNodes.map(n => n.id));

  visibleNodes.forEach(code => {
    const prereqs = adjList.get(code);
    if (prereqs) {
      prereqs.forEach(pre => {
        if (visibleNodes.has(pre)) {
          const edgeId = `${pre}->${code}`;
          if (!addedEdges.has(edgeId)) {
            const isSelectedPath = (pre === selectedCourseCode || code === selectedCourseCode);
            edgesToAdd.push({
              id: edgeId,
              from: pre,
              to: code,
              color: isSelectedPath ? '#8b5cf6' : (isLightTheme ? 'rgba(124,58,237,0.35)' : 'rgba(139,92,246,0.35)'),
              width: isSelectedPath ? 2.5 : 1.2,
              arrows: { to: { enabled: true, scaleFactor: 0.6 } }
            });
            addedEdges.add(edgeId);
          }
        }
      });
    }
  });

  if (edgesToAdd.length) networkEdges.add(edgesToAdd);
}

/**
 * Sync the left-panel "ענפים מוסתרים" section to the current hiddenBranches array.
 * Shows the panel when there is at least one hidden branch; hides it otherwise.
 */
function updateHiddenBranchesPanel() {
  const group = document.getElementById("hidden-branches-group");
  const list  = document.getElementById("hidden-branches-list");

  if (hiddenBranches.length === 0) {
    group.style.display = "none";
    return;
  }

  group.style.display = "block";
  list.innerHTML = "";

  hiddenBranches.forEach(branch => {
    const item = document.createElement("div");
    item.className = "hidden-branch-item";
    item.innerHTML = `
      <span class="hidden-branch-name" title="${branch.rootName}">${branch.rootName}</span>
      <span class="hidden-branch-count">(${branch.codes.size})</span>
      <button class="restore-branch-btn" title="שחזר ענף">
        <i class="fa-solid fa-rotate-left"></i> שחזר
      </button>
    `;
    item.querySelector(".restore-branch-btn").addEventListener("click", () => {
      restoreCourseBranch(branch.root);
    });
    list.appendChild(item);
  });
}
