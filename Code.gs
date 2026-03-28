// ==========================================
// 実践の本棚 - Code.gs  v3
// ==========================================

const ROSTER_SHEET  = '教員名簿';
const RECORDS_SHEET = '実践記録';
const MEDIA_FOLDER  = '実践記録_メディア';

// ============ ルーティング ============

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'main';
  let file, title;
  if      (page === 'admin')   { file = 'admin';   title = '実践の本棚｜管理者'; }
  else if (page === 'library') { file = 'library'; title = '実践の本棚｜公共図書館'; }
  else                         { file = 'index';   title = '実践の本棚'; }
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// ============ ユーティリティ ============

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

// セットアップ確認用（デバッグ）
function checkSetup() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { ok: false, message: 'スプレッドシートが見つかりません。スクリプトがスプレッドシートにバインドされているか確認してください。' };
    const sheetNames = ss.getSheets().map(s => s.getName());
    return { ok: true, spreadsheetName: ss.getName(), sheets: sheetNames };
  } catch(e) {
    return { ok: false, message: e.toString() };
  }
}

// 記録の読み込み診断用（Apps Scriptエディタから直接実行して確認）
function debugRecords() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = {
      spreadsheetName: ss.getName(),
      allSheets: ss.getSheets().map(s => s.getName()),
      recordsSheetExists: false,
      lastRow: 0, lastCol: 0,
      sampleRaw: null,
      sampleParsed: null,
      totalParsed: 0,
      error: null
    };

    const sheet = ss.getSheetByName(RECORDS_SHEET);
    if (!sheet) { Logger.log('debugRecords: ' + JSON.stringify(result)); return result; }

    result.recordsSheetExists = true;
    result.lastRow = sheet.getLastRow();
    result.lastCol = sheet.getLastColumn();

    if (sheet.getLastRow() >= 2) {
      const raw = sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), 13)).getValues()[0];
      result.sampleRaw = {
        A_id:     String(raw[0]) + ' [' + typeof raw[0] + ']',
        D_author: String(raw[3]),
        E_title:  String(raw[4]),
        F_when:   String(raw[5]) + ' [' + (raw[5] instanceof Date ? 'Date' : typeof raw[5]) + ']',
        L_media:  String(raw[11]).substring(0, 50)
      };
      try { result.sampleParsed = parseRecord_(raw); } catch(pe) { result.error = 'parseRecord_ エラー: ' + pe.toString(); }
    }

    const allRecs = getAllRecords();
    result.totalParsed = allRecs.length;

    Logger.log('=== debugRecords 結果 ===\n' + JSON.stringify(result, null, 2));
    return result;
  } catch(e) {
    const r = { error: e.toString() };
    Logger.log('debugRecords 例外: ' + e.toString());
    return r;
  }
}

function findTeacherRow_(sheet, name) {
  if (sheet.getLastRow() < 2) return null;
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === name) return { row: i + 2, data: vals[i] };
  }
  return null;
}

function ensureRosterHeaders_() {
  const ss = ss_();
  let sheet = ss.getSheetByName(ROSTER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ROSTER_SHEET);
    const h = ['氏名','PIN','所属学年','所属学級','専科名','登録日','管理者'];
    sheet.appendRow(h);
    sheet.getRange(1,1,1,h.length).setBackground('#5D4037').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureRecordsSheet_() {
  const ss = ss_();
  let sheet = ss.getSheetByName(RECORDS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RECORDS_SHEET);
    const h = ['ID','記録日時','更新日時','著者','タイトル','いつ','どこで','誰が','具体的な言動','教師の仕掛け','成果と課題','メディア','閲覧数'];
    sheet.appendRow(h);
    sheet.getRange(1,1,1,h.length).setBackground('#5D4037').setFontColor('white').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ============ リアルタイム同期 ============

function getLastModified() {
  return PropertiesService.getScriptProperties().getProperty('lastModified') || '0';
}

function touchLastModified_() {
  PropertiesService.getScriptProperties().setProperty('lastModified', new Date().getTime().toString());
}

function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ============ 1. 認証 ============

function getTeacherList() {
  const sheet = ss_().getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .getValues().map(r => r[0]).filter(v => v !== '');
}

function loginWithPin(name, inputPin) {
  const sheet = ensureRosterHeaders_();
  const found = findTeacherRow_(sheet, name);
  if (!found) return { success: false, message: '名前が見つかりません' };
  const saved = found.data[1];
  if (saved === '' || saved === null) {
    sheet.getRange(found.row, 2).setValue(inputPin);
    sheet.getRange(found.row, 6).setValue(new Date());
    touchLastModified_();
    return { success: true, type: 'REGISTER' };
  }
  if (saved.toString() === inputPin.toString()) return { success: true, type: 'LOGIN' };
  return { success: false, message: 'パスワードが違います' };
}

function adminLogin(name, inputPin) {
  const result = loginWithPin(name, inputPin);
  if (!result.success) return result;
  const sheet = ss_().getSheetByName(ROSTER_SHEET);
  const found = findTeacherRow_(sheet, name);
  if (!found || !found.data[6]) return { success: false, message: '管理者権限がありません' };
  return { success: true, type: result.type };
}

// ============ 2. 教員管理 ============

function getTeacherRoster() {
  const sheet = ensureRosterHeaders_();
  if (sheet.getLastRow() < 2) return [];
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  return vals.filter(r => r[0] !== '').map(r => ({
    name:         r[0],
    pin:          r[1] !== '' && r[1] !== null ? r[1].toString() : '',
    grade:        r[2] || '',
    class_:       r[3] || '',
    specialty:    r[4] || '',
    registeredAt: r[5] ? (r[5] instanceof Date ? r[5].toLocaleDateString('ja-JP') : r[5].toString()) : '',
    isAdmin:      !!r[6]
  }));
}

function addTeacher(data) {
  const sheet = ensureRosterHeaders_();
  if (findTeacherRow_(sheet, data.name)) return { success: false, message: '同じ名前がすでに登録されています' };
  sheet.appendRow([data.name, '', data.grade||'', data.class_||'', data.specialty||'', '', data.isAdmin ? true : false]);
  touchLastModified_();
  return { success: true };
}

function updateTeacher(originalName, data) {
  const sheet = ensureRosterHeaders_();
  const found = findTeacherRow_(sheet, originalName);
  if (!found) return { success: false, message: '先生が見つかりません' };
  const row = found.row;
  sheet.getRange(row, 1).setValue(data.name       || originalName);
  sheet.getRange(row, 3).setValue(data.grade      || '');
  sheet.getRange(row, 4).setValue(data.class_     || '');
  sheet.getRange(row, 5).setValue(data.specialty  || '');
  sheet.getRange(row, 7).setValue(data.isAdmin ? true : false);
  if (data.name && data.name !== originalName) syncAuthorName_(originalName, data.name);
  touchLastModified_();
  return { success: true };
}

function deleteTeacher(name) {
  const sheet = ss_().getSheetByName(ROSTER_SHEET);
  if (!sheet) return { success: false };
  const found = findTeacherRow_(sheet, name);
  if (!found) return { success: false };
  sheet.deleteRow(found.row);
  touchLastModified_();
  return { success: true };
}

function bulkDeleteTeachers() {
  const sheet = ss_().getSheetByName(ROSTER_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0 };
  const count = sheet.getLastRow() - 1;
  sheet.deleteRows(2, count);
  touchLastModified_();
  return { success: true, count: count };
}

// ============ 3. パスワード管理 ============

function getTeacherPasswords() {
  return getTeacherRoster().map(t => ({ name: t.name, pin: t.pin }));
}

function changePassword(name, newPin) {
  const sheet = ss_().getSheetByName(ROSTER_SHEET);
  if (!sheet) return { success: false };
  const found = findTeacherRow_(sheet, name);
  if (!found) return { success: false };
  sheet.getRange(found.row, 2).setValue(newPin);
  touchLastModified_();
  return { success: true };
}

function resetPassword(name) { return changePassword(name, ''); }

// ============ 4. 記録 CRUD ============

function parseRecord_(r) {
  // Google Sheets が日付を Date型で返すことがあるため、
  // google.script.run でクライアントに渡す前にすべて文字列/数値に変換する
  function safeStr(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
    return String(v);
  }

  let media = [];
  try { media = JSON.parse(r[11] || '[]'); } catch(e) { media = []; }

  return {
    id:            safeStr(r[0]),
    createdAt:     safeStr(r[1]),
    updatedAt:     safeStr(r[2]),
    author:        safeStr(r[3]),
    title:         safeStr(r[4]),
    when:          safeStr(r[5]),
    wherePractice: safeStr(r[6]),
    who:           safeStr(r[7]),
    behaviors:     safeStr(r[8]),
    approach:      safeStr(r[9]),
    results:       safeStr(r[10]),
    media:         media,
    viewCount:     Number(r[12]) || 0
  };
}

function saveRecord(author, data) {
  try {
    const sheet = ensureRecordsSheet_();
    const id = Utilities.getUuid();
    const now = new Date();
    sheet.appendRow([id, now, now, author,
      data.title||'', data.when||'', data.wherePractice||'', data.who||'',
      data.behaviors||'', data.approach||'', data.results||'',
      JSON.stringify(data.media||[]), 0]);
    try { touchLastModified_(); } catch(e2) { /* 非致命的：無視 */ }
    return { success: true, id: id };
  } catch(e) {
    return { success: false, message: 'saveRecord エラー: ' + e.toString() };
  }
}

function updateRecord(author, id, data) { return updateRecord_(id, data, author, false); }
function adminUpdateRecord(id, data)    { return updateRecord_(id, data, null,   true);  }

function updateRecord_(id, data, author, isAdmin) {
  const sheet = ensureRecordsSheet_();
  if (sheet.getLastRow() < 2) return { success: false };
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === id && (isAdmin || vals[i][3] === author)) {
      const row = i + 2;
      const upd = { 3: new Date(), 5: data.title||'', 6: data.when||'',
        7: data.wherePractice||'', 8: data.who||'',
        9: data.behaviors||'', 10: data.approach||'',
        11: data.results||'', 12: JSON.stringify(data.media||[]) };
      Object.entries(upd).forEach(([c,v]) => sheet.getRange(row, Number(c)).setValue(v));
      try { touchLastModified_(); } catch(e2) { /* 非致命的：無視 */ }
      return { success: true };
    }
  }
  return { success: false, message: '記録が見つかりません' };
}

function deleteRecord(author, id) { return deleteRecord_(id, author, false); }
function adminDeleteRecord(id)    { return deleteRecord_(id, null,   true);  }

function deleteRecord_(id, author, isAdmin) {
  const sheet = ensureRecordsSheet_();
  if (sheet.getLastRow() < 2) return { success: false };
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === id && (isAdmin || vals[i][3] === author)) {
      sheet.deleteRow(i + 2);
      try { touchLastModified_(); } catch(e2) { /* 非致命的：無視 */ }
      return { success: true };
    }
  }
  return { success: false };
}

function adminBulkDeleteRecords(author) {
  const sheet = ss_().getSheetByName(RECORDS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0 };
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  let count = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i][3] === author) { sheet.deleteRow(i + 2); count++; }
  }
  if (count > 0) touchLastModified_();
  return { success: true, count: count };
}

// ============ 5. データ取得 ============

function getAllRecords() {
  try {
    const sheet = ss_().getSheetByName(RECORDS_SHEET);
    if (!sheet) { Logger.log('getAllRecords: 実践記録シートが見つかりません'); return []; }
    if (sheet.getLastRow() < 2) { Logger.log('getAllRecords: データ行がありません (lastRow=' + sheet.getLastRow() + ')'); return []; }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    // 最低13列、シートの実際の列数に合わせて読み込む
    const readCols = Math.max(lastCol, 13);
    const values = sheet.getRange(2, 1, lastRow - 1, readCols).getValues();

    const records = [];
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      if (!r[0] || String(r[0]).trim() === '') continue; // IDが空の行はスキップ
      try {
        records.push(parseRecord_(r));
      } catch (parseErr) {
        Logger.log('parseRecord_ エラー (行' + (i + 2) + '): ' + parseErr.toString());
      }
    }
    records.reverse();
    Logger.log('getAllRecords: ' + records.length + '件取得');
    return records;
  } catch(e) {
    Logger.log('getAllRecords 例外: ' + e.toString());
    return [];
  }
}

function getMyRecords(author)    { return getAllRecords().filter(r => r.author === author); }
function getAdminRecords(author) { return author ? getMyRecords(author) : getAllRecords(); }

function getAdminDashboard() {
  const roster  = getTeacherRoster();
  const records = getAllRecords();
  const stats   = {};
  records.forEach(r => {
    if (!stats[r.author]) stats[r.author] = { bookCount: 0, totalViews: 0 };
    stats[r.author].bookCount++;
    stats[r.author].totalViews += r.viewCount;
  });
  return roster.map(t => ({
    ...t,
    bookCount:  (stats[t.name] || {}).bookCount  || 0,
    totalViews: (stats[t.name] || {}).totalViews || 0
  }));
}

// ============ 6. 閲覧数 ============

function incrementViewCount(id) {
  const sheet = ss_().getSheetByName(RECORDS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === id) {
      const cur = Number(sheet.getRange(i + 2, 13).getValue()) || 0;
      sheet.getRange(i + 2, 13).setValue(cur + 1);
      return;
    }
  }
}

// ============ 7. 画像アップロード ============

function saveImageToDrive(fileName, mimeType, base64Data) {
  try {
    const folders = DriveApp.getFoldersByName(MEDIA_FOLDER);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(MEDIA_FOLDER);
    const blob    = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file    = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: 'https://drive.google.com/uc?export=view&id=' + file.getId(), name: fileName, type: mimeType };
  } catch(e) { return { success: false, message: e.toString() }; }
}

// ============ 内部ヘルパー ============

function syncAuthorName_(oldName, newName) {
  const sheet = ss_().getSheetByName(RECORDS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  const vals = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === oldName) sheet.getRange(i + 2, 4).setValue(newName);
  }
}
