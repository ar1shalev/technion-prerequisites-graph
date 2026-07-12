// App State
let coursesData = [];
let coursesMap = new Map(); // code -> course object
let faculties = [];
let activeFaculties = new Set();
let selectedCourseCode = null;
let currentSemester = null;
let viewMode = 'faculty'; // 'faculty' or 'local' or 'global'
let examFilter = 'all'; // 'all', 'has_exam', 'no_exam'
let activeDays = new Set(); // Set of days
let courseSemestersMap = new Map(); // code -> Set of semesters
let showAllHistoricalCourses = false;
let showExternalCourses = false;
let showSportsCourses = false;
let currentFilteredCourses = []; // courses that match criteria, excluding prereqs
let historicalCoursesInfo = new Map(); // code -> { name, faculty, points }

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

function getFacultyColor(facultyName) {
  return FACULTY_COLORS[facultyName] || DEFAULT_COLOR;
}

// Initialization on DOM load
document.addEventListener("DOMContentLoaded", () => {
  initSemesterSelect();
  setupEventListeners();
  loadAllSemestersIndex(); // Load the semesters mapping in background
});

// Load all semesters in the background to build the offerings map
async function loadAllSemestersIndex() {
  try {
    const response = await fetch("data/last_semesters.json");
    if (!response.ok) return;
    const semesters = await response.json();

    // Load all in background
    const promises = semesters.map(async (sem) => {
      const key = `${sem.year}-${sem.semester}`;
      let semName = "";
      if (sem.semester === 200) semName = "חורף";
      else if (sem.semester === 201) semName = "אביב";
      else if (sem.semester === 202) semName = "קיץ";
      const label = `${semName} ${sem.year}`;

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

              // Cache historical course info
              if (!historicalCoursesInfo.has(code)) {
                historicalCoursesInfo.set(code, {
                  name: course.general["שם מקצוע"],
                  faculty: course.general["פקולטה"],
                  points: course.general["נקודות"]
                });
              }
            }
          });
        }
      } catch (e) {
        console.error(`Failed to load historical data for ${key}`, e);
      }
    });

    await Promise.all(promises);
    // If a course is currently selected, refresh details to display its semesters
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
    const semesters = await response.ok ? await response.json() : [];

    const select = document.getElementById("semester-select");
    select.innerHTML = "";

    semesters.forEach(sem => {
      const option = document.createElement("option");
      option.value = `${sem.year}-${sem.semester}`;

      let semName = "";
      if (sem.semester === 200) semName = "חורף";
      else if (sem.semester === 201) semName = "אביב";
      else if (sem.semester === 202) semName = "קיץ";

      option.textContent = `סמסטר ${semName} ${sem.year} (${sem.year % 100}/${(sem.year + 1) % 100})`;
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

    // Clear search and selection on semester change
    document.getElementById("course-search").value = "";
    document.getElementById("clear-search-btn").style.display = "none";
    selectedCourseCode = null;

    // Clear hidden branches state
    hiddenCourses.clear();
    hiddenBranches = [];
    hiddenNodePositions = {};
    updateHiddenBranchesPanel();

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

// Extract course codes from prerequisite string
function parsePrerequisites(prereqStr) {
  if (!prereqStr) return [];
  // Matches 8-digit numbers representing course codes
  const matches = prereqStr.match(/\b\d{8}\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

// Build adjacency lists for graph traversal
function buildGraph() {
  adjList.clear();
  revAdjList.clear();
  coReqList.clear();

// Initialize lists for all known courses
for (const code of coursesMap.keys()) {
  adjList.set(code, new Set());
  revAdjList.set(code, new Set());
  coReqList.set(code, new Set());
}

// Populate lists
for (const [code, course] of coursesMap.entries()) {
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

      renderGraph();
    });

    container.appendChild(tag);
  });

  // Populate Legend
  updateLegend();
}

function updateLegend() {
  const container = document.getElementById("legend-items");
  container.innerHTML = "";

  // 1. Course status section (offered / supporting / external)
  const statusHeader = document.createElement("div");
  statusHeader.className = "legend-title";
  statusHeader.style.borderBottom = "none";
  statusHeader.style.paddingBottom = "0";
  statusHeader.style.marginTop = "0";
  statusHeader.textContent = "סטטוס הקורסים בסמסטר זה:";
  container.appendChild(statusHeader);

  // Normal Offered course
  const normItem = document.createElement("div");
  normItem.className = "legend-item";
  const normColor = document.createElement("span");
  normColor.className = "legend-color";
  normColor.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
  normColor.style.border = "1.5px solid #8b5cf6";
  normColor.style.borderRadius = "4px";
  const normLabel = document.createElement("span");
  normLabel.className = "legend-label";
  normLabel.textContent = "קורס מוצע בסמסטר הנוכחי (גבול מוצק)";
  normItem.appendChild(normColor);
  normItem.appendChild(normLabel);
  container.appendChild(normItem);

  // Supporting Prerequisite from other faculty
  const supportItem = document.createElement("div");
  supportItem.className = "legend-item";
  const supportColor = document.createElement("span");
  supportColor.className = "legend-color";
  supportColor.style.backgroundColor = "rgba(10, 10, 15, 0.95)";
  supportColor.style.border = "1.5px dashed #8b5cf6";
  supportColor.style.borderRadius = "4px";
  const supportLabel = document.createElement("span");
  supportLabel.className = "legend-label";
  supportLabel.textContent = "דרישת קדם מפקולטה אחרת (גבול מקווקו)";
  supportItem.appendChild(supportColor);
  supportItem.appendChild(supportLabel);
  container.appendChild(supportItem);

  // External course (not offered)
  const extItem = document.createElement("div");
  extItem.className = "legend-item";
  const extColor = document.createElement("span");
  extColor.className = "legend-color";
  extColor.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
  extColor.style.border = "1.5px dashed #ef4444";
  extColor.style.borderRadius = "4px";
  const extLabel = document.createElement("span");
  extLabel.className = "legend-label";
  extLabel.textContent = "קורס חיצוני - לא מוצע (גבול אדום)";
  extItem.appendChild(extColor);
  extItem.appendChild(extLabel);
  container.appendChild(extItem);

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
        const mockCourse = {
          general: {
            "מספר מקצוע": code,
            "שם מקצוע": hist.name,
            "פקולטה": hist.faculty,
            "נקודות": hist.points
          },
          schedule: [],
          isHistorical: true
        };
        if (courseMatchesFilters(mockCourse)) {
          currentFilteredCourses.push(mockCourse);
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
      let course = coursesMap.get(code);
      if (!course) {
        if (historicalCoursesInfo.has(code)) {
          const hist = historicalCoursesInfo.get(code);
          course = {
            general: { "מספר מקצוע": code, "שם מקצוע": hist.name, "פקולטה": hist.faculty, "נקודות": hist.points },
            schedule: [],
            isHistorical: true
          };
        } else if (showExternalCourses) {
          filteredRelevantNodes.add(code);
          return;
        } else {
          return;
        }
      }

      if (courseMatchesFilters(course)) {
        if (!course.isHistorical || showAllHistoricalCourses || showExternalCourses) {
          filteredRelevantNodes.add(code);
        }
      }
    });

    // Add nodes
    filteredRelevantNodes.forEach(code => {
      const course = coursesMap.get(code);
      const isSelected = code === selectedCourseCode;

      if (!course && !isSelected && !showExternalCourses) {
        return;
      }

      let labelText = code;
      if (course) {
        labelText = wrapText(course.general["שם מקצוע"], 15);
      }

      let nodeObj = {
        id: code,
        label: labelText,
        font: { size: isSelected ? 12 : 10, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' }
      };

      if (course) {
        const fac = course.general["פקולטה"];
        const name = course.general["שם מקצוע"];
        nodeObj.title = `<b>${code}</b> - ${name}<br>${fac}<br>נקודות: ${course.general["נקודות"]}`;

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
      } else {
        // External node (not offered this semester) - Colored Red
        nodeObj.title = `<b>${code}</b><br>קורס חיצוני (לא מוצע הסמסטר)`;
        nodeObj.color = {
          background: 'rgba(239, 68, 68, 0.08)',
          border: '#ef4444',
          highlight: { background: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' }
        };
        nodeObj.borderWidth = 1.5;
        nodeObj.shapeProperties = { borderDashes: [3, 3] };
        nodeObj.font = { color: isLightTheme ? '#b91c1c' : '#fca5a5', size: 9.5 };
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
    // Apply advanced filters and faculty/global constraints
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
          title: `<b>${code}</b> - ${name}<br>${fac}<br>נקודות: ${course.general["נקודות"]}`,
          color: {
            background: isSelected ? hexToRgba(getFacultyColor(fac), 0.8) : hexToRgba(getFacultyColor(fac), isLightTheme ? 0.15 : 0.25),
            border: isSelected ? (isLightTheme ? '#111827' : '#ffffff') : getFacultyColor(fac),
            highlight: {
              background: isSelected ? hexToRgba(getFacultyColor(fac), 0.9) : hexToRgba(getFacultyColor(fac), 0.45),
              border: isLightTheme ? '#111827' : '#ffffff'
            }
          },
          borderWidth: isSelected ? 3 : 2, // Thicker solid border for offered course
          font: { size: isSelected ? 12 : 10, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' },
          shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
        };

        nodes.push(nodeObj);
        addedNodes.add(code);
      } else {
        // It's a historical course (not offered this semester)
        const hist = historicalCoursesInfo.get(code);
        if (hist) {
          const fac = hist.faculty;
          const name = hist.name;
          const nodeObj = {
            id: code,
            label: wrapText(name, 15),
            title: `<b>${code}</b> - ${name}<br>${fac} (לא מוצע הסמסטר)<br>נקודות: ${hist.points}`,
            color: {
              background: 'rgba(239, 68, 68, 0.08)', // transparent red
              border: '#ef4444', // bright red
              highlight: { background: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' }
            },
            borderWidth: 1.5,
            shapeProperties: { borderDashes: [3, 3] },
            font: { color: isLightTheme ? '#b91c1c' : '#fca5a5', size: 9.5 },
            shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
          };
          nodes.push(nodeObj);
          addedNodes.add(code);
        }
      }
    });


    // Expand graph to include direct requisites from other faculties (User feedback!)
    coreCourses.forEach(code => {
      const prereqs = adjList.get(code) || new Set();
      prereqs.forEach(pre => {
        if (!addedNodes.has(pre)) {
          // pre is in another faculty (supporting node)
          const course = coursesMap.get(pre);
          if (!course && !showExternalCourses) {
            return;
          }
          let nodeObj = {
            id: pre,
            borderWidth: 1.5,
            font: { size: 9.5 }
          };

          if (course) {
            const fac = course.general["פקולטה"];
            nodeObj.label = wrapText(course.general["שם מקצוע"], 15);
            nodeObj.title = `<b>${pre}</b> - ${course.general["שם מקצוע"]}<br>${fac} (דרישת קדם תומכת)<br>נקודות: ${course.general["נקודות"]}`;
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
            nodeObj.font = { color: isLightTheme ? '#4b5563' : '#a1a1aa', size: 9.5 };
          } else {
            // External node - Colored Red
            nodeObj.label = pre;
            nodeObj.title = `<b>${pre}</b><br>קורס חיצוני (לא מוצע הסמסטר)`;
            nodeObj.color = {
              background: 'rgba(239, 68, 68, 0.08)',
              border: '#ef4444',
              highlight: { background: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' }
            };
            nodeObj.borderWidth = 1.5;
            nodeObj.shapeProperties = { borderDashes: [3, 3] };
            nodeObj.font = { color: isLightTheme ? '#b91c1c' : '#fca5a5', size: 9.5 };
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
      barnesHut: {
        gravitationalConstant: -12000,
        centralGravity: 0.1,
        springLength: 220,
        springConstant: 0.02,
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
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      hideEdgesOnDrag: true,
      hideEdgesOnZoom: true
    }
  };

  // Use Hierarchical Layout for Local Centric Graph
  if (viewMode === 'local') {
    options.physics = { enabled: false }; // Disable simulation for hierarchy
    options.layout = {
      hierarchical: {
        direction: 'UD', // Up-Down (top to bottom)
        sortMethod: 'directed',
        nodeSpacing: 220,
        levelSeparation: 180,
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
    if (viewMode !== 'local') {
      // Disable physics to prevent jitter after stabilization
      network.setOptions({ physics: { enabled: false } });
    }
  });

  // Trigger fit to screen on loaded
  if (viewMode === 'local') {
    setTimeout(() => {
      network.fit({ animation: true });
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

  const course = coursesMap.get(selectedCourseCode);
  const isExternal = !course;

  if (isExternal) {
    const hist = historicalCoursesInfo.get(selectedCourseCode);
    const facultyColor = hist ? getFacultyColor(hist.faculty) : "#4b5563";
    const titleText = hist ? hist.name : "קורס חיצוני";
    const facText = hist ? hist.faculty : "חיצוני";
    const ptsText = hist ? hist.points : "לא ידוע";

    const offeredSems = courseSemestersMap.get(selectedCourseCode);
    const semsText = offeredSems ? Array.from(offeredSems).join(", ") : "לא נמצאו סמסטרים";

    container.innerHTML = `
      <div class="course-card" style="--faculty-color: ${facultyColor}">
        <div class="course-card-header">
          <h2 class="course-card-title">${titleText}</h2>
          <div class="course-card-code">${selectedCourseCode}</div>
        </div>
        <div class="course-meta-grid">
          <div class="meta-item">
            <span class="meta-label">פקולטה</span>
            <span class="meta-value">${facText}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">נקודות</span>
            <span class="meta-value points-badge">${ptsText}</span>
          </div>
          <div class="meta-item" style="grid-column: span 2; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 8px;">
            <span class="meta-label">סמסטרים שבהם נלמד (בשלוש השנים האחרונות)</span>
            <span class="meta-value" style="color: var(--secondary); font-weight: 500; font-size: 12.5px;">${semsText}</span>
          </div>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary); margin-top: 15px; line-height: 1.4;">
          הקורס אינו מועבר בסמסטר הנוכחי שנבחר, אך תוכל לראות למעלה באילו סמסטרים הוא מוצע בדרך כלל.
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

  if (!showExternalCourses) {
    displayPrereqs = directPrereqs.filter(code => coursesMap.has(code));
    displayUnlocks = directUnlocks.filter(code => coursesMap.has(code));
    displayRecPrereqs = recursivePrereqs.filter(code => coursesMap.has(code));
    displayRecUnlocks = recursiveUnlocks.filter(code => coursesMap.has(code));
  }

  // Determine if course has a final exam
  const hasExam = (gen["מועד א"] || gen["מועד ב"]) ? "כן" : "לא";

  // Get semesters in which this course is offered
  let currentSemName = "";
  const [curYear, curSem] = currentSemester.split("-");
  if (curSem === "200") currentSemName = `חורף ${curYear}`;
  else if (curSem === "201") currentSemName = `אביב ${curYear}`;
  else if (curSem === "202") currentSemName = `קיץ ${curYear}`;

  const offeredSems = courseSemestersMap.get(selectedCourseCode);
  const semsText = offeredSems ? Array.from(offeredSems).join(", ") : currentSemName;

  let html = `
    <!-- Course Title & Code -->
    <div class="course-card" style="--faculty-color: ${facultyColor}">
      <div class="course-card-header">
        <h2 class="course-card-title">${gen["שם מקצוע"]}</h2>
        <div class="course-card-code">${selectedCourseCode}</div>
      </div>
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
          <span class="meta-label">סמסטרים שבהם נלמד (בשלוש השנים האחרונות)</span>
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
        ${gen["מקצועות קדם"] ? `<div style="font-weight: 500; margin-bottom: 12px; color: var(--text-primary);">לוגיקת דרישה: <span style="font-family: var(--font-he); color: var(--warning);">${gen["מקצועות קדם"]}</span></div>` : ''}
        <div class="req-list">
          ${displayPrereqs.length > 0 ? displayPrereqs.map(code => renderReqLink(code)).join('') : '<div class="req-empty">אין דרישות ישירות</div>'}
        </div>
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

  container.innerHTML = html;
}

// Render small link card for prereqs/unlocks lists
function renderReqLink(code) {
  const target = coursesMap.get(code);
  const name = target ? target.general["שם מקצוע"] : "קורס חיצוני/לא מוצע";
  return `
    <div class="req-link" onclick="selectCourse('${code}')">
      <span class="req-link-text" title="${name}">${name}</span>
      <span class="req-link-code">${code}</span>
    </div>
  `;
}

// Toggle collapsible sidebar card sections
function toggleSection(headerElement) {
  const section = headerElement.parentElement;
  section.classList.toggle("collapsed");
}

// Toggle Local / Faculty view mode
function toggleLocalView(enableLocal) {
  if (enableLocal) {
    viewMode = 'local';
    document.getElementById("btn-view-local").classList.add("active");
    document.getElementById("btn-view-faculty").classList.remove("active");
    document.getElementById("btn-view-global").classList.remove("active");
  } else {
    viewMode = 'faculty';
    document.getElementById("btn-view-faculty").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    document.getElementById("btn-view-global").classList.remove("active");
  }
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

    // Filter courses matching code or name
    const matches = [];
    for (const [code, course] of coursesMap.entries()) {
      const name = course.general["שם מקצוע"].toLowerCase();
      if (code.includes(val) || name.includes(val)) {
        matches.push({ code, name: course.general["שם מקצוע"] });
      }
      if (matches.length >= 10) break; // Limit suggestions to 10
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
    viewMode = 'faculty';
    document.getElementById("btn-view-faculty").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    document.getElementById("btn-view-global").classList.remove("active");
    renderGraph();
  });

  document.getElementById("btn-view-local").addEventListener("click", () => {
    if (!selectedCourseCode) {
      alert("אנא בחר קורס תחילה כדי לצפות בגרף הקשרים הישיר שלו.");
      return;
    }
    toggleLocalView(true);
  });

  document.getElementById("btn-view-global").addEventListener("click", () => {
    viewMode = 'global';
    document.getElementById("btn-view-global").classList.add("active");
    document.getElementById("btn-view-local").classList.remove("active");
    document.getElementById("btn-view-faculty").classList.remove("active");
    renderGraph();
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

  // Faculty filtering headers: Select All / Clear All
  document.getElementById("btn-select-all-faculties").addEventListener("click", () => {
    faculties.forEach(f => activeFaculties.add(f));
    document.querySelectorAll(".faculty-tag").forEach(tag => tag.classList.add("active"));
    renderGraph();
  });

  document.getElementById("btn-clear-all-faculties").addEventListener("click", () => {
    activeFaculties.clear();
    document.querySelectorAll(".faculty-tag").forEach(tag => tag.classList.remove("active"));
    renderGraph();
  });

  // Advanced Exam Filter Toggles
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      examFilter = e.currentTarget.dataset.value;
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
    renderGraph();
  });

  // Toggle showing external/non-offered prerequisite courses
  document.getElementById("chk-show-external").addEventListener("change", (e) => {
    showExternalCourses = e.target.checked;
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
}

// Populate the modal courses table based on search input
function populateModalCoursesTable(query = "") {
  const tableBody = document.getElementById("modal-courses-table-body");
  const countSpan = document.getElementById("modal-courses-count");
  tableBody.innerHTML = "";

  const trimmedQuery = query.trim().toLowerCase();

  // Filter list
  const filtered = currentFilteredCourses.filter(course => {
    if (!trimmedQuery) return true;
    const code = (course.general["מספר מקצוע"] || "").toLowerCase();
    const name = (course.general["שם מקצוע"] || "").toLowerCase();
    return code.includes(trimmedQuery) || name.includes(trimmedQuery);
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
      title: `<b>${code}</b> - ${name}<br>${fac}<br>נקודות: ${course.general["נקודות"]}`,
      color: {
        background: isSelected ? hexToRgba(getFacultyColor(fac), 0.8) : hexToRgba(getFacultyColor(fac), isLightTheme ? 0.15 : 0.25),
        border: isSelected ? (isLightTheme ? '#111827' : '#ffffff') : getFacultyColor(fac),
        highlight: {
          background: isSelected ? hexToRgba(getFacultyColor(fac), 0.9) : hexToRgba(getFacultyColor(fac), 0.45),
          border: isLightTheme ? '#111827' : '#ffffff'
        }
      },
      borderWidth: isSelected ? 3 : 2,
      font: { size: isSelected ? 12 : 10, bold: isSelected, color: isLightTheme ? '#111827' : '#ffffff' },
      shadow: isSelected ? { enabled: true, color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)', size: 10 } : false
    };
  }

  // Historical node
  const hist = historicalCoursesInfo.get(code);
  const isLT = document.body.classList.contains("light-theme");
  if (hist) {
    return {
      id: code,
      label: wrapText(hist.name, 15),
      title: `<b>${code}</b> - ${hist.name}<br>${hist.faculty} (לא מוצע הסמסטר)<br>נקודות: ${hist.points}`,
      color: { background: 'rgba(239,68,68,0.08)', border: '#ef4444', highlight: { background: 'rgba(239,68,68,0.2)', border: '#ef4444' } },
      borderWidth: 1.5,
      shapeProperties: { borderDashes: [3, 3] },
      font: { color: isLT ? '#b91c1c' : '#fca5a5', size: 9.5 },
      shadow: false
    };
  }

  // Pure external node
  return {
    id: code,
    label: code,
    title: `<b>${code}</b><br>קורס חיצוני (לא מוצע הסמסטר)`,
    color: { background: 'rgba(239, 68, 68, 0.08)', border: '#ef4444', highlight: { background: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' } },
    borderWidth: 1.5,
    shapeProperties: { borderDashes: [3, 3] },
    font: { color: isLT ? '#b91c1c' : '#fca5a5', size: 9.5 },
    shadow: false
  };
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
 * Restore a previously hidden branch in-place: adds node + edge objects
 * directly into the live vis.js DataSets, then enables physics briefly so
 * the new nodes settle near their neighbours without moving existing ones.
 */
function restoreCourseBranch(rootCode) {
  const idx = hiddenBranches.findIndex(b => b.root === rootCode);
  if (idx === -1) return;
  const branch = hiddenBranches.splice(idx, 1)[0];

  // Rebuild hiddenCourses from remaining branches
  hiddenCourses.clear();
  hiddenBranches.forEach(b => b.codes.forEach(c => hiddenCourses.add(c)));

  _addBranchToDataset(branch.codes);
  updateHiddenBranchesPanel();

  // Also refresh the filtered-courses cache
  refreshCurrentFilteredCourses();
}

/** Remove all hidden branches and add all nodes back in-place. */
function resetAllHiddenBranches() {
  const allCodes = new Set(hiddenCourses); // snapshot before clearing
  hiddenCourses.clear();
  hiddenBranches = [];

  _addBranchToDataset(allCodes);
  updateHiddenBranchesPanel();

  refreshCurrentFilteredCourses();
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
