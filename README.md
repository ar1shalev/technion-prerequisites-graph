# technion-prerequisites-graph

An interactive course visualization graph for the Technion, organized by prerequisites, corequisites, and future unlock paths.

A successor of
[technion-ug-info-fetcher](https://github.com/michael-maltsev/technion-ug-info-fetcher).

## The data

The script runs on a regular basis, and the data can be found in the [gh-pages
branch](https://github.com/michael-maltsev/technion-sap-info-fetcher/tree/gh-pages).

## Usage

```
courses_to_json.py 2024-200 courses.json
```

Specify the desired year and semester in the following format: `YYYY-SSS`, for
example `2024-200` for a Winter 2024-2025 semester. `200` and `201` mean Winter
and Spring, respectively.

The result will be saved in the specified JSON file.

## Example

An example of a course entry:

```json
{
  "general": {
    "מספר מקצוע": "02340124",
    "שם מקצוע": "מבוא לתכנות מערכות",
    "סילבוס": "השלמות שפת C: מצביעים, רשומות, ניהול זיכרון דינמי, רשימות מקושרות, עצים. ניהול גרסאות. הידור, קישור, ושימוש בספריות. פקודות LLEHS בסיסיות. פייתון כשפת \"דבק\" של המערכת. ניפוי שגיאות, בדיקת תוכנה, בדיקה אוטומטית. מבוא ל- C++ : תכנות מונחה עצמים, טיפוסי נתונים מופשטים, פולימורפיזם דינמי וסטטי.",
    "פקולטה": "הפקולטה למדעי המחשב",
    "מסגרת לימודים": "קדם אקדמי/תיכוני",
    "מקצועות קדם": "(02340114) או (02340117)",
    "מקצועות ללא זיכוי נוסף": "00440101 00940219 01040824 02340121 02340122",
    "נקודות": "4",
    "אחראים": "",
    "הערות": ""
  },
  "schedule": [
    {
      "קבוצה": 11,
      "סוג": "הרצאה",
      "יום": "ראשון",
      "שעה": "14:30 - 16:30",
      "בניין": "",
      "חדר": 0,
      "מרצה/מתרגל": "ד\"ר יוסף ויינשטיין",
      "מס.": 10
    },
    {
      "קבוצה": 11,
      "סוג": "תרגול",
      "יום": "חמישי",
      "שעה": "12:30 - 14:30",
      "בניין": "",
      "חדר": 0,
      "מרצה/מתרגל": "",
      "מס.": 11
    },
    {
      "קבוצה": 12,
      "סוג": "הרצאה",
      "יום": "ראשון",
      "שעה": "14:30 - 16:30",
      "בניין": "",
      "חדר": 0,
      "מרצה/מתרגל": "ד\"ר יוסף ויינשטיין",
      "מס.": 10
    },
    {
      "קבוצה": 12,
      "סוג": "תרגול",
      "יום": "שני",
      "שעה": "10:30 - 12:30",
      "בניין": "",
      "חדר": 0,
      "מרצה/מתרגל": "",
      "מס.": 12
    },
    ...
  ]
}
```

## Updating the Website with New Semester Data

To update the interactive graph website with the latest semesters and course data from the Technion portal, follow these steps:

### 1. Prerequisite Installations
Make sure you have python3 and the required libraries installed:
```bash
pip install requests tqdm
```

### 2. Fetch and Re-generate Semester Files
Run the scraper script with the `last-N` option. This will query the Technion servers for the active semesters list, create the select index, and pull course details for the last `N` semesters (we recommend pulling `24` semesters to cover an 8-year history, including Winter, Spring, and Summer terms):
```bash
python3 courses_to_json.py last-24 "data/courses_{year}_{semester}.json" --last-semesters-output-file "data/last_semesters.json"
```

The script will:
- Write `data/last_semesters.json` containing the metadata for the active semesters.
- Query and generate `data/courses_{year}_{semester}.json` files for each catalog term.

### 3. Deploy
Commit the updated `data/` folder and push to your GitHub Pages branch. The web application dynamically reads `data/last_semesters.json` and loads the corresponding course details as the user navigates, requiring no changes to the HTML, CSS, or JS files!
